use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::{CLAIM_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::MerkleAirdropError;
use crate::state::{Claim, Config};

#[derive(Accounts)]
pub struct ClaimWithSignature<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = claimant,
        space = 8 + Claim::INIT_SPACE,
        seeds = [CLAIM_SEED, claimant.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, Claim>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump,
        token::mint = mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = claimant,
        associated_token::mint = mint,
        associated_token::authority = claimant,
        associated_token::token_program = token_program,
    )]
    pub claimant_ata: Account<'info, TokenAccount>,

    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub claimant: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    /// CHECK: Instructions sysvar account used for Ed25519 introspection.
    #[account(address = ix_sysvar::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

pub fn claim_with_signature(ctx: Context<ClaimWithSignature>, amount: u64) -> Result<()> {
    require!(amount > 0, MerkleAirdropError::ZeroAmount);

    let instructions_sysvar = &ctx.accounts.instructions_sysvar;
    let current_index = ix_sysvar::load_current_index_checked(instructions_sysvar)?;
    require!(
        current_index > 0,
        MerkleAirdropError::SignatureVerificationFailed
    );

    // Look for the Ed25519 instruction among preceding instructions
    let mut found_ed25519 = None;
    for i in (0..current_index).rev() {
        if let Ok(ix) = ix_sysvar::load_instruction_at_checked(i as usize, instructions_sysvar) {
            if ix.program_id == anchor_lang::solana_program::ed25519_program::ID {
                found_ed25519 = Some(ix);
                break;
            }
        }
    }

    let ed25519_ix = found_ed25519.ok_or(MerkleAirdropError::SignatureVerificationFailed)?;

    require!(
        ed25519_ix.data.len() >= 16,
        MerkleAirdropError::SignatureVerificationFailed
    );
    require!(
        ed25519_ix.data[0] == 1,
        MerkleAirdropError::SignatureVerificationFailed
    );

    let pubkey_offset =
        u16::from_le_bytes(ed25519_ix.data[6..8].try_into().unwrap()) as usize;
    let msg_offset =
        u16::from_le_bytes(ed25519_ix.data[10..12].try_into().unwrap()) as usize;
    let msg_size =
        u16::from_le_bytes(ed25519_ix.data[12..14].try_into().unwrap()) as usize;

    require!(
        ed25519_ix.data.len() >= pubkey_offset + 32,
        MerkleAirdropError::SignatureVerificationFailed
    );
    require!(
        &ed25519_ix.data[pubkey_offset..pubkey_offset + 32]
            == ctx.accounts.config.signer.as_ref(),
        MerkleAirdropError::SignatureVerificationFailed
    );

    let mut expected_msg = Vec::with_capacity(72);
    expected_msg.extend_from_slice(ctx.accounts.claimant.key.as_ref());
    expected_msg.extend_from_slice(&amount.to_le_bytes());
    expected_msg.extend_from_slice(ctx.program_id.as_ref());

    require!(
        ed25519_ix.data.len() >= msg_offset + msg_size,
        MerkleAirdropError::SignatureVerificationFailed
    );
    require!(
        &ed25519_ix.data[msg_offset..msg_offset + msg_size] == expected_msg.as_slice(),
        MerkleAirdropError::SignatureVerificationFailed
    );

    ctx.accounts.claim.claimant = ctx.accounts.claimant.key();

    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.claimant_ata.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    Ok(())
}
