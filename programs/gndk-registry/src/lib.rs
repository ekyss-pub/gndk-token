use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("6SZBJmypA1eC6R8C8iPXSRZevwT5bFPuAEcBbSrk1srw");

// ═══════════════════════════════════════════════════════════════
// GNDK Registry — Core Program
// ═══════════════════════════════════════════════════════════════
//
// 역할: 토큰 풀 관리, 유저 등록, 모듈 등록, Dynamic Halving,
//       보상 분배 (CPI 수신), BurnRecycle (CPI 수신)
//
// 사양: EKYSS_L2E_TOKENOMICS_SOLANA.md v2.5.4-sol
// ═══════════════════════════════════════════════════════════════

#[program]
pub mod gndk_registry {
    use super::*;

    // ─── 초기화 ───

    pub fn initialize(ctx: Context<Initialize>, oracle: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, oracle)
    }

    pub fn initialize_reward_pool(ctx: Context<InitializeRewardPool>) -> Result<()> {
        instructions::initialize::handler_reward_pool(ctx)
    }

    pub fn initialize_d2e_pool(ctx: Context<InitializeD2EPool>) -> Result<()> {
        instructions::initialize::handler_d2e_pool(ctx)
    }

    pub fn initialize_burn_stats(ctx: Context<InitializeBurnStats>) -> Result<()> {
        instructions::initialize::handler_burn_stats(ctx)
    }

    // ─── 등록 ───

    pub fn register_user(ctx: Context<RegisterUser>) -> Result<()> {
        instructions::register_user::handler(ctx)
    }

    pub fn register_module(
        ctx: Context<RegisterModule>,
        name: String,
        pool_type: u8,
        daily_limit: u64,
        annual_limit: u64,
    ) -> Result<()> {
        instructions::register_module::handler(ctx, name, pool_type, daily_limit, annual_limit)
    }

    // ─── 풀 출금 (CPI) ───

    pub fn transfer_from_pool(ctx: Context<TransferFromPool>, amount: u64) -> Result<()> {
        instructions::transfer_from_pool::handler(ctx, amount)
    }

    pub fn transfer_from_d2e_pool(ctx: Context<TransferFromD2EPool>, amount: u64) -> Result<()> {
        instructions::transfer_from_d2e_pool::handler(ctx, amount)
    }

    // ─── Admin ───

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        instructions::admin::handler_pause(ctx)
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        instructions::admin::handler_unpause(ctx)
    }

    pub fn deactivate_module(ctx: Context<AdminModule>) -> Result<()> {
        instructions::admin::handler_deactivate_module(ctx)
    }

    pub fn pause_module(ctx: Context<AdminModule>) -> Result<()> {
        instructions::admin::handler_pause_module(ctx)
    }

    pub fn unpause_module(ctx: Context<AdminModule>) -> Result<()> {
        instructions::admin::handler_unpause_module(ctx)
    }

    pub fn update_oracle(ctx: Context<AdminOnly>, new_oracle: Pubkey) -> Result<()> {
        instructions::admin::handler_update_oracle(ctx, new_oracle)
    }
}
