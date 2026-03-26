use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

// CPI into gndk-registry
use gndk_registry::cpi::accounts::TransferFromPool as RegistryTransferFromPool;
use gndk_registry::program::GndkRegistry;
use gndk_registry::state::{
    ConfigAccount, ModuleAccount, RewardPoolAuthority, UserAccount,
};

declare_id!("Ed1GRcVHtXq1fJxwN8SC7rWjmwC4S6kVRGoXKkmv6AkS");

// ═══════════════════════════════════════════════════════════════
// GNDK L2E Module — Learn-to-Earn
// ═══════════════════════════════════════════════════════════════
//
// 역할: 학습 보상 분배 — oracle/admin이 호출 → CPI → Registry
// Stage 1: Direct Transfer (포인트 → GNDK 변환은 off-chain)
// Stage 2: Merkle 기반 배치 처리 (추후)
// ═══════════════════════════════════════════════════════════════

#[program]
pub mod l2e_module {
    use super::*;

    /// L2E Config 초기화 — admin, registry 연결, mint 바인딩
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let l2e_config = &mut ctx.accounts.l2e_config;
        l2e_config.admin = ctx.accounts.admin.key();
        l2e_config.oracle = ctx.accounts.oracle.key();
        l2e_config.mint = ctx.accounts.mint.key();
        l2e_config.is_active = true;
        l2e_config.total_distributed = 0;
        l2e_config.bump = ctx.bumps.l2e_config;

        msg!("L2E Module initialized — mint: {}", l2e_config.mint);
        Ok(())
    }

    /// L2E 보상 분배 — oracle이 호출, CPI → Registry.transfer_from_pool
    ///
    /// 플로우: eKYSS 서버 → oracle TX → L2E distribute → CPI → Registry
    /// Registry가 모든 한도 검증 (Phase cap, daily limit 등)
    pub fn distribute(ctx: Context<Distribute>, amount: u64) -> Result<()> {
        let l2e_config = &ctx.accounts.l2e_config;
        require!(l2e_config.is_active, L2EError::ModuleNotActive);

        // oracle 또는 admin만 호출 가능
        let caller_key = ctx.accounts.caller.key();
        require!(
            caller_key == l2e_config.oracle || caller_key == l2e_config.admin,
            L2EError::Unauthorized
        );

        // CPI → Registry.transfer_from_pool
        // Registry가 Phase cap, daily limit, annual limit 전부 검증
        let cpi_program = ctx.accounts.registry_program.to_account_info();
        let cpi_accounts = RegistryTransferFromPool {
            config: ctx.accounts.registry_config.to_account_info(),
            module_account: ctx.accounts.module_account.to_account_info(),
            pool_authority: ctx.accounts.pool_authority.to_account_info(),
            reward_pool_ata: ctx.accounts.reward_pool_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            user_account: ctx.accounts.user_account.to_account_info(),
            user_ata: ctx.accounts.user_ata.to_account_info(),
            caller: ctx.accounts.caller.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        gndk_registry::cpi::transfer_from_pool(cpi_ctx, amount)?;

        // L2E 자체 통계 업데이트
        let l2e_config = &mut ctx.accounts.l2e_config;
        l2e_config.total_distributed = l2e_config.total_distributed
            .checked_add(amount)
            .ok_or(L2EError::Overflow)?;

        msg!("L2E distribute: {} GNDK to {}", amount, ctx.accounts.user_ata.key());
        Ok(())
    }

    /// Oracle 업데이트
    pub fn update_oracle(ctx: Context<L2EAdminOnly>, new_oracle: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.l2e_config.admin,
            L2EError::Unauthorized
        );
        ctx.accounts.l2e_config.oracle = new_oracle;
        msg!("L2E oracle updated: {}", new_oracle);
        Ok(())
    }

    /// L2E 일시 중지
    pub fn pause(ctx: Context<L2EAdminOnly>) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.l2e_config.admin,
            L2EError::Unauthorized
        );
        ctx.accounts.l2e_config.is_active = false;
        msg!("L2E Module paused");
        Ok(())
    }

    /// L2E 재개
    pub fn unpause(ctx: Context<L2EAdminOnly>) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.l2e_config.admin,
            L2EError::Unauthorized
        );
        ctx.accounts.l2e_config.is_active = true;
        msg!("L2E Module unpaused");
        Ok(())
    }
}

// ─── State ───

#[account]
pub struct L2EConfig {
    pub admin: Pubkey,            // 32
    pub oracle: Pubkey,           // 32
    pub mint: Pubkey,             // 32 — GSA-11: bound token mint
    pub is_active: bool,          // 1
    pub total_distributed: u64,   // 8
    pub bump: u8,                 // 1
}
// space: 8 + 32 + 32 + 32 + 1 + 8 + 1 = 114

impl L2EConfig {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 1 + 8 + 1; // 114
}

// ─── Instructions ───

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = L2EConfig::SIZE,
        seeds = [b"l2e_config"],
        bump,
    )]
    pub l2e_config: Account<'info, L2EConfig>,

    /// CHECK: oracle pubkey
    pub oracle: UncheckedAccount<'info>,

    /// GNDK Mint — bound at init, validated on every distribute
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Distribute<'info> {
    #[account(
        mut,
        seeds = [b"l2e_config"],
        bump = l2e_config.bump,
    )]
    pub l2e_config: Account<'info, L2EConfig>,

    // ─── Registry accounts (CPI target) ───

    /// Registry program
    pub registry_program: Program<'info, GndkRegistry>,

    /// Registry config PDA
    #[account(mut)]
    pub registry_config: Account<'info, ConfigAccount>,

    /// L2E ModuleAccount in Registry
    #[account(mut)]
    pub module_account: Account<'info, ModuleAccount>,

    /// RewardPool authority PDA
    pub pool_authority: Account<'info, RewardPoolAuthority>,

    /// RewardPool token account
    #[account(mut)]
    pub reward_pool_ata: InterfaceAccount<'info, TokenAccount>,

    /// GNDK Mint — must match the mint bound at initialization (GSA-11)
    #[account(constraint = mint.key() == l2e_config.mint @ L2EError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// User account in Registry
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,

    /// User token account
    #[account(mut)]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

    // ─── Signers ───

    /// oracle or admin
    pub caller: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct L2EAdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"l2e_config"],
        bump = l2e_config.bump,
    )]
    pub l2e_config: Account<'info, L2EConfig>,

    pub admin: Signer<'info>,
}

// ─── Errors ───

#[error_code]
pub enum L2EError {
    #[msg("Unauthorized: admin or oracle only")]
    Unauthorized,

    #[msg("L2E Module is not active")]
    ModuleNotActive,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Mint mismatch: expected the mint bound at initialization")]
    MintMismatch,
}
