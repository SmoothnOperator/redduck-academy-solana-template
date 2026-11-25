use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::token_interface::Token2022;

use crate::constants::{CONFIG_SEED, VAULT_SEED};
use crate::state::Config;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED],
        bump,
        token::mint = rddk_mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub rddk_mint: Account<'info, Mint>,

    /// CHECK: vRDDK is a Token-2022 non-transferable mint with authority = config PDA.
    pub vrddk_mint: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub token2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.rddk_mint = ctx.accounts.rddk_mint.key();
    config.vrddk_mint = ctx.accounts.vrddk_mint.key();
    config.vault = ctx.accounts.vault.key();
    config.bump = ctx.bumps.config;
    config.vault_bump = ctx.bumps.vault;
    Ok(())
}
