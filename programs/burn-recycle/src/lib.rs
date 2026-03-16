use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("EV5A8bfAyqYqgscwd2PRoHfTqPg9w7Uxuwgmo4TTYzXp");

// ═══════════════════════════════════════════════════════════════
// GNDK BurnRecycle — Service Payment Processing
// ═══════════════════════════════════════════════════════════════
//
// 역할:
//   1. process_payment — 결제 GNDK: 50% 영구 소각 + 50% 풀 리사이클
//   2. admin_burn — Buyback & Burn: 100% 소각 (D2E 매출 등)
//
// 리사이클 대상: Registry의 RewardPool ATA (토큰 전송은 authority 불필요)
//
// 사양: Section 6.2, 8.3
// ═══════════════════════════════════════════════════════════════

const BURN_RATIO: u64 = 50; // 50% burn, 50% recycle
const TOKEN_DECIMALS: u8 = 9;
const DECIMALS_FACTOR: u64 = 1_000_000_000;

#[program]
pub mod burn_recycle {
    use super::*;

    /// BurnRecycle 초기화
    /// C-9 fix: mint를 Account로 받아 실제 Mint 계정인지 검증
    pub fn initialize(
        ctx: Context<Initialize>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.mint = ctx.accounts.mint.key();
        config.total_burned = 0;
        config.total_recycled = 0;
        config.total_admin_burned = 0;
        config.is_active = true;
        config.bump = ctx.bumps.config;

        msg!("BurnRecycle initialized");
        Ok(())
    }

    /// 서비스 결제 처리: 50% 영구 소각 + 50% RewardPool 리사이클
    ///
    /// 유저가 서비스(수강권, He/She 등) 결제 시 호출
    /// amount: GNDK 단위 (decimals 미적용)
    pub fn process_payment(ctx: Context<ProcessPayment>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.is_active, BurnRecycleError::ProgramPaused);

        let total_raw = amount
            .checked_mul(DECIMALS_FACTOR)
            .ok_or(BurnRecycleError::Overflow)?;

        // 50% 영구 소각
        let burn_amount = total_raw
            .checked_mul(BURN_RATIO)
            .ok_or(BurnRecycleError::Overflow)?
            .checked_div(100)
            .ok_or(BurnRecycleError::Overflow)?;

        // 50% 풀 리사이클
        let recycle_amount = total_raw
            .checked_sub(burn_amount)
            .ok_or(BurnRecycleError::Overflow)?;

        // 1. Burn (SPL Token burn — mint supply 영구 감소)
        let cpi_burn = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.payer_ata.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        );
        token_interface::burn(cpi_burn, burn_amount)?;

        // 2. Recycle (transfer to RewardPool ATA — authority 불필요)
        let cpi_transfer = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.payer_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.reward_pool_ata.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        );
        token_interface::transfer_checked(cpi_transfer, recycle_amount, TOKEN_DECIMALS)?;

        // 3. 통계 업데이트
        let config = &mut ctx.accounts.config;
        config.total_burned = config.total_burned
            .checked_add(burn_amount)
            .ok_or(BurnRecycleError::Overflow)?;
        config.total_recycled = config.total_recycled
            .checked_add(recycle_amount)
            .ok_or(BurnRecycleError::Overflow)?;

        msg!(
            "BurnRecycle: {} raw burned, {} raw recycled (payment {} GNDK)",
            burn_amount, recycle_amount, amount
        );
        Ok(())
    }

    /// Admin Burn: 100% 소각 (Buyback & Burn, D2E 매출 소각 등)
    ///
    /// amount: GNDK 단위
    pub fn admin_burn(ctx: Context<AdminBurn>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.is_active, BurnRecycleError::ProgramPaused);
        require!(
            ctx.accounts.admin.key() == config.admin,
            BurnRecycleError::Unauthorized
        );

        let burn_raw = amount
            .checked_mul(DECIMALS_FACTOR)
            .ok_or(BurnRecycleError::Overflow)?;

        // 100% 소각
        let cpi_burn = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.admin_ata.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        );
        token_interface::burn(cpi_burn, burn_raw)?;

        let config = &mut ctx.accounts.config;
        config.total_admin_burned = config.total_admin_burned
            .checked_add(burn_raw)
            .ok_or(BurnRecycleError::Overflow)?;
        config.total_burned = config.total_burned
            .checked_add(burn_raw)
            .ok_or(BurnRecycleError::Overflow)?;

        msg!("AdminBurn: {} GNDK ({} raw) permanently burned", amount, burn_raw);
        Ok(())
    }

    /// Pause
    pub fn pause(ctx: Context<BurnAdminOnly>) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.config.admin,
            BurnRecycleError::Unauthorized
        );
        ctx.accounts.config.is_active = false;
        msg!("BurnRecycle paused");
        Ok(())
    }

    /// Unpause
    pub fn unpause(ctx: Context<BurnAdminOnly>) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.config.admin,
            BurnRecycleError::Unauthorized
        );
        ctx.accounts.config.is_active = true;
        msg!("BurnRecycle unpaused");
        Ok(())
    }
}

// ─── State ───

#[account]
pub struct BurnRecycleConfig {
    pub admin: Pubkey,             // 32
    pub mint: Pubkey,              // 32
    pub total_burned: u64,         // 8 — 누적 소각 (raw)
    pub total_recycled: u64,       // 8 — 누적 리사이클 (raw)
    pub total_admin_burned: u64,   // 8 — admin_burn 누적 (raw)
    pub is_active: bool,           // 1
    pub bump: u8,                  // 1
}
// space: 8 + 32 + 32 + 8 + 8 + 8 + 1 + 1 = 98

impl BurnRecycleConfig {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 1; // 98
}

// ─── Instructions ───

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = BurnRecycleConfig::SIZE,
        seeds = [b"burn_recycle_config"],
        bump,
    )]
    pub config: Account<'info, BurnRecycleConfig>,

    /// C-9 fix: mint를 실제 Account로 받아 Mint 타입 검증
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPayment<'info> {
    #[account(
        mut,
        seeds = [b"burn_recycle_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, BurnRecycleConfig>,

    /// C-3 fix: mint가 config.mint과 일치하는지 검증
    #[account(mut, constraint = mint.key() == config.mint @ BurnRecycleError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// C-3 fix: payer_ata의 mint 검증
    #[account(mut, token::mint = mint)]
    pub payer_ata: InterfaceAccount<'info, TokenAccount>,

    /// C-3 fix: reward_pool_ata의 mint 검증
    #[account(mut, token::mint = mint)]
    pub reward_pool_ata: InterfaceAccount<'info, TokenAccount>,

    /// 결제자 (서명)
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct AdminBurn<'info> {
    #[account(
        mut,
        seeds = [b"burn_recycle_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, BurnRecycleConfig>,

    /// C-3 fix: mint 검증
    #[account(mut, constraint = mint.key() == config.mint @ BurnRecycleError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// C-3 fix: admin_ata mint 검증
    #[account(mut, token::mint = mint)]
    pub admin_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct BurnAdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"burn_recycle_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, BurnRecycleConfig>,

    pub admin: Signer<'info>,
}

// ─── Errors ───

#[error_code]
pub enum BurnRecycleError {
    #[msg("Unauthorized: admin only")]
    Unauthorized,

    #[msg("BurnRecycle is paused")]
    ProgramPaused,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Mint does not match config")]
    MintMismatch,
}
