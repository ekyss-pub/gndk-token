use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GndkError;
use crate::state::*;

// ═══════════════════════════════════════════════════════════════
// register_module — 외부 모듈(L2E, D2E 등)을 Registry에 등록
// ═══════════════════════════════════════════════════════════════
//
// admin만 호출 가능 (향후 multi-sig)
// pool_type: 0=L2E RewardPool, 1=D2E BountyPool

pub fn handler(
    ctx: Context<RegisterModule>,
    name: String,
    pool_type: u8,
    daily_limit: u64,
    annual_limit: u64,
) -> Result<()> {
    require!(name.len() <= MAX_MODULE_NAME_LEN, GndkError::NameTooLong);
    require!(
        pool_type == POOL_TYPE_L2E || pool_type == POOL_TYPE_D2E,
        GndkError::PoolTypeMismatch
    );
    require!(
        ctx.accounts.admin.key() == ctx.accounts.config.admin,
        GndkError::Unauthorized
    );

    let module = &mut ctx.accounts.module_account;
    module.program_id = ctx.accounts.module_program.key();
    module.name = name.clone();
    module.pool_type = pool_type;
    module.daily_limit = daily_limit;
    module.daily_used = 0;
    module.last_reset_day = super::register_user::get_current_day()?;
    module.annual_limit = annual_limit;
    module.is_active = true;
    module.module_pause = false;
    module.bump = ctx.bumps.module_account;

    let pool_name = if pool_type == POOL_TYPE_L2E { "L2E" } else { "D2E" };
    msg!(
        "Module registered: {} (pool={}, daily={}, annual={})",
        name, pool_name, daily_limit, annual_limit
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterModule<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ConfigAccount>,

    #[account(
        init,
        payer = admin,
        space = ModuleAccount::SIZE,
        seeds = [b"module", module_program.key().as_ref()],
        bump,
    )]
    pub module_account: Account<'info, ModuleAccount>,

    /// CHECK: 등록할 모듈 프로그램 ID
    pub module_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
