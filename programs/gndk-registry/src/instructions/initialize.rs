use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::*;

// ═══════════════════════════════════════════════════════════════
// initialize — TGE 시 1회 실행, ConfigAccount 생성
// ═══════════════════════════════════════════════════════════════

pub fn handler(ctx: Context<Initialize>, oracle: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.oracle = oracle;
    config.mint = ctx.accounts.mint.key();
    config.current_phase = 0; // Phase 1 시작
    config.total_registered_users = 0;
    config.global_pause = false;
    config.total_distributed = 0;
    config.total_d2e_distributed = 0;
    config.total_burned = 0;
    config.total_recycled = 0;
    config.tge_timestamp = Clock::get()?.unix_timestamp;
    config.bump = ctx.bumps.config;

    msg!("GNDK Registry initialized — Phase 1");
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = ConfigAccount::SIZE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ═══════════════════════════════════════════════════════════════
// initialize_reward_pool — L2E Ecosystem Reward Pool 생성
// ═══════════════════════════════════════════════════════════════

pub fn handler_reward_pool(ctx: Context<InitializeRewardPool>) -> Result<()> {
    let pool_auth = &mut ctx.accounts.pool_authority;
    pool_auth.bump = ctx.bumps.pool_authority;

    msg!("L2E RewardPool initialized: {}", ctx.accounts.reward_pool_ata.key());
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeRewardPool<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    #[account(
        init,
        payer = admin,
        space = RewardPoolAuthority::SIZE,
        seeds = [b"reward_pool", config.mint.as_ref()],
        bump,
    )]
    pub pool_authority: Account<'info, RewardPoolAuthority>,

    #[account(
        init,
        payer = admin,
        token::mint = mint,
        token::authority = pool_authority,
    )]
    pub reward_pool_ata: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ═══════════════════════════════════════════════════════════════
// initialize_d2e_pool — D2E Bounty Pool 생성
// ═══════════════════════════════════════════════════════════════

pub fn handler_d2e_pool(ctx: Context<InitializeD2EPool>) -> Result<()> {
    let pool_auth = &mut ctx.accounts.d2e_pool_authority;
    pool_auth.bump = ctx.bumps.d2e_pool_authority;

    msg!("D2E BountyPool initialized: {}", ctx.accounts.d2e_pool_ata.key());
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeD2EPool<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    #[account(
        init,
        payer = admin,
        space = D2EPoolAuthority::SIZE,
        seeds = [b"d2e_pool", config.mint.as_ref()],
        bump,
    )]
    pub d2e_pool_authority: Account<'info, D2EPoolAuthority>,

    #[account(
        init,
        payer = admin,
        token::mint = mint,
        token::authority = d2e_pool_authority,
    )]
    pub d2e_pool_ata: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ═══════════════════════════════════════════════════════════════
// initialize_burn_stats — BurnRecycle 통계 PDA 생성
// ═══════════════════════════════════════════════════════════════

pub fn handler_burn_stats(ctx: Context<InitializeBurnStats>) -> Result<()> {
    let burn_stats = &mut ctx.accounts.burn_stats;
    burn_stats.total_burned = 0;
    burn_stats.total_recycled = 0;
    burn_stats.bump = ctx.bumps.burn_stats;

    msg!("BurnStats initialized");
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeBurnStats<'info> {
    #[account(
        init,
        payer = admin,
        space = BurnStats::SIZE,
        seeds = [b"burn_stats"],
        bump,
    )]
    pub burn_stats: Account<'info, BurnStats>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
