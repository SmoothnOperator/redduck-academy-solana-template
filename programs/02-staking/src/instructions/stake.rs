use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::{CONFIG_SEED, STAKE_SEED, USER_SEED, VAULT_SEED};
use crate::error::StakingError;
use crate::state::{Config, StakePosition, UserState};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
        token::mint = rddk_mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: User state PDA, created on first stake and mutated on subsequent stakes.
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump
    )]
    pub user_state: AccountInfo<'info>,

    /// CHECK: Verified against PDA seeds [STAKE_SEED, user, index] and created in handler.
    #[account(mut)]
    pub stake_position: AccountInfo<'info>,

    #[account(
        mut,
        token::mint = rddk_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_rddk_ata: Account<'info, TokenAccount>,

    #[account(address = config.rddk_mint)]
    pub rddk_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, StakingError::ZeroAmount);

    // 1. Transfer RDDK from user to vault
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.user_rddk_ata.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount,
    )?;

    // 2. Manage persistent user_state safely
    let current_index: u64;
    let rent = Rent::get()?;

    if ctx.accounts.user_state.data_is_empty() {
        let (expected_pda, bump) = Pubkey::find_program_address(
            &[USER_SEED, ctx.accounts.user.key.as_ref()],
            ctx.program_id,
        );
        require_keys_eq!(ctx.accounts.user_state.key(), expected_pda, StakingError::Unauthorized);

        let space = 8 + UserState::INIT_SPACE;
        let lamports = rent.minimum_balance(space);

        let signer_seeds: &[&[&[u8]]] = &[&[
            USER_SEED,
            ctx.accounts.user.key.as_ref(),
            &[bump],
        ]];

        system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.user_state.to_account_info(),
                },
                signer_seeds,
            ),
            lamports,
            space as u64,
            ctx.program_id,
        )?;

        let mut data = ctx.accounts.user_state.try_borrow_mut_data()?;
        let initial_state = UserState {
            user: ctx.accounts.user.key(),
            stake_count: 1,
        };
        initial_state.try_serialize(&mut &mut data[..])?;
        current_index = 0;
    } else {
        require!(
            ctx.accounts.user_state.owner == ctx.program_id,
            ProgramError::IllegalOwner
        );
        let mut data = ctx.accounts.user_state.try_borrow_mut_data()?;
        let mut user_state = UserState::try_deserialize(&mut &data[..])?;
        require!(user_state.user == ctx.accounts.user.key(), StakingError::Unauthorized);
        current_index = user_state.stake_count;
        user_state.stake_count = user_state
            .stake_count
            .checked_add(1)
            .ok_or(StakingError::CalculationOverflow)?;
        user_state.try_serialize(&mut &mut data[..])?;
    }

    // 3. Create and initialize stake_position
    let (expected_pos_pda, pos_bump) = Pubkey::find_program_address(
        &[
            STAKE_SEED,
            ctx.accounts.user.key.as_ref(),
            current_index.to_le_bytes().as_ref(),
        ],
        ctx.program_id,
    );
    require_keys_eq!(ctx.accounts.stake_position.key(), expected_pos_pda, StakingError::Unauthorized);

    let pos_space = 8 + StakePosition::INIT_SPACE;
    let pos_lamports = rent.minimum_balance(pos_space);

    let pos_signer_seeds: &[&[&[u8]]] = &[&[
        STAKE_SEED,
        ctx.accounts.user.key.as_ref(),
        current_index.to_le_bytes().as_ref(),
        &[pos_bump],
    ]];

    system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::CreateAccount {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.stake_position.to_account_info(),
            },
            pos_signer_seeds,
        ),
        pos_lamports,
        pos_space as u64,
        ctx.program_id,
    )?;

    let clock = Clock::get()?;
    let mut pos_data = ctx.accounts.stake_position.try_borrow_mut_data()?;
    let position = StakePosition {
        user: ctx.accounts.user.key(),
        index: current_index,
        amount,
        staked_at: clock.unix_timestamp,
        is_claimed: false,
    };
    position.try_serialize(&mut &mut pos_data[..])?;

    Ok(())
}
