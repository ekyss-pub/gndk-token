use anchor_lang::prelude::*;

use crate::errors::GndkError;
use crate::state::*;

// ═══════════════════════════════════════════════════════════════
// Admin Instructions — pause, unpause, deactivate_module, etc.
// ═══════════════════════════════════════════════════════════════

// ─── Global Pause / Unpause ───

pub fn handler_pause(ctx: Context<AdminOnly>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.config.admin,
        GndkError::Unauthorized
    );
    ctx.accounts.config.global_pause = true;
    msg!("GNDK Registry PAUSED");
    Ok(())
}

pub fn handler_unpause(ctx: Context<AdminOnly>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.config.admin,
        GndkError::Unauthorized
    );
    ctx.accounts.config.global_pause = false;
    msg!("GNDK Registry UNPAUSED");
    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    pub admin: Signer<'info>,
}

// ─── Module Deactivate ───

pub fn handler_deactivate_module(ctx: Context<AdminModule>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.config.admin,
        GndkError::Unauthorized
    );
    ctx.accounts.module_account.is_active = false;
    msg!("Module deactivated: {}", ctx.accounts.module_account.name);
    Ok(())
}

// ─── Module Pause / Unpause ───

pub fn handler_pause_module(ctx: Context<AdminModule>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.config.admin,
        GndkError::Unauthorized
    );
    ctx.accounts.module_account.module_pause = true;
    msg!("Module paused: {}", ctx.accounts.module_account.name);
    Ok(())
}

pub fn handler_unpause_module(ctx: Context<AdminModule>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.config.admin,
        GndkError::Unauthorized
    );
    ctx.accounts.module_account.module_pause = false;
    msg!("Module unpaused: {}", ctx.accounts.module_account.name);
    Ok(())
}

// ─── Update Oracle ───

pub fn handler_update_oracle(ctx: Context<AdminOnly>, new_oracle: Pubkey) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.config.admin,
        GndkError::Unauthorized
    );
    ctx.accounts.config.oracle = new_oracle;
    msg!("Oracle updated: {}", new_oracle);
    Ok(())
}

#[derive(Accounts)]
pub struct AdminModule<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    #[account(
        mut,
        seeds = [b"module", module_account.program_id.as_ref()],
        bump = module_account.bump,
    )]
    pub module_account: Account<'info, ModuleAccount>,

    pub admin: Signer<'info>,
}
