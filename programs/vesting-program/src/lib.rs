use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("6w23izAP5v6WzqA9eAgb96WvWtckKbquhKbPfXmgMwok");

// ═══════════════════════════════════════════════════════════════
// GNDK Vesting — Cliff + Linear Unlock
// ═══════════════════════════════════════════════════════════════
//
// 사양서 Section 3.2:
//   - Early Contributors (10%): 1년 cliff + 1년 linear
//   - Private Sale (10%): 1년 cliff + 1년 linear
//   - Team/Advisors (5%): 1년 cliff + 2년 linear
//
// 기능:
//   1. create_vesting — admin이 수혜자별 스케줄 생성
//   2. claim — 수혜자가 해제된 물량 인출
//   3. revoke — admin이 미해제 물량 회수 (해제 완료분은 유지)
// ═══════════════════════════════════════════════════════════════

const TOKEN_DECIMALS: u8 = 9;
const DECIMALS_FACTOR: u64 = 1_000_000_000;

#[program]
pub mod vesting_program {
    use super::*;

    /// Vesting Config 초기화
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.mint = ctx.accounts.mint.key();
        config.total_vesting_created = 0;
        config.total_claimed = 0;
        config.total_revoked = 0;
        config.bump = ctx.bumps.config;

        msg!("Vesting program initialized");
        Ok(())
    }

    /// Vesting Vault 초기화 (토큰 보관용 PDA ATA)
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault_auth = &mut ctx.accounts.vault_authority;
        vault_auth.bump = ctx.bumps.vault_authority;

        msg!("Vesting vault initialized: {}", ctx.accounts.vault_ata.key());
        Ok(())
    }

    /// Vesting 스케줄 생성
    ///
    /// admin이 vault에 토큰 입금 후 수혜자별 스케줄 생성
    /// total_amount: GNDK 단위 (decimals 미적용)
    /// cliff_duration: cliff 기간 (seconds)
    /// vesting_duration: linear unlock 기간 (seconds, cliff 이후)
    pub fn create_vesting(
        ctx: Context<CreateVesting>,
        total_amount: u64,
        cliff_duration: i64,
        vesting_duration: i64,
    ) -> Result<()> {
        require!(total_amount > 0, VestingError::InvalidAmount);
        require!(cliff_duration >= 0, VestingError::InvalidDuration);
        require!(vesting_duration > 0, VestingError::InvalidDuration);

        let config = &ctx.accounts.config;
        require!(
            ctx.accounts.admin.key() == config.admin,
            VestingError::Unauthorized
        );

        let clock = Clock::get()?;
        let start_time = clock.unix_timestamp;

        // Admin → Vault로 토큰 전송
        let transfer_raw = total_amount
            .checked_mul(DECIMALS_FACTOR)
            .ok_or(VestingError::Overflow)?;

        let cpi_transfer = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.admin_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        );
        token_interface::transfer_checked(cpi_transfer, transfer_raw, TOKEN_DECIMALS)?;

        // Vesting 스케줄 생성
        let vesting = &mut ctx.accounts.vesting_account;
        vesting.beneficiary = ctx.accounts.beneficiary.key();
        vesting.mint = config.mint;
        vesting.total_amount = total_amount;
        vesting.claimed_amount = 0;
        vesting.start_time = start_time;
        vesting.cliff_end = start_time + cliff_duration;
        vesting.vesting_end = start_time + cliff_duration + vesting_duration;
        vesting.revoked = false;
        vesting.revoke_time = 0;
        vesting.bump = ctx.bumps.vesting_account;

        // Config 통계
        let config = &mut ctx.accounts.config;
        config.total_vesting_created = config.total_vesting_created
            .checked_add(total_amount)
            .ok_or(VestingError::Overflow)?;

        msg!(
            "Vesting created: {} GNDK for {}, cliff={}s, vest={}s",
            total_amount, vesting.beneficiary, cliff_duration, vesting_duration
        );
        Ok(())
    }

    /// 해제된 토큰 인출
    ///
    /// 수혜자만 호출 가능
    /// cliff 이전: 0
    /// cliff ~ vesting_end: linear 비례
    /// vesting_end 이후: 전액
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let vesting = &ctx.accounts.vesting_account;

        require!(
            ctx.accounts.beneficiary.key() == vesting.beneficiary,
            VestingError::Unauthorized
        );
        require!(!vesting.revoked, VestingError::VestingRevoked);

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // 해제 가능 금액 계산
        let vested = calc_vested_amount(vesting, now);
        let claimable = vested
            .checked_sub(vesting.claimed_amount)
            .ok_or(VestingError::Overflow)?;

        require!(claimable > 0, VestingError::NothingToClaim);

        // Vault → 수혜자 토큰 전송
        let transfer_raw = claimable
            .checked_mul(DECIMALS_FACTOR)
            .ok_or(VestingError::Overflow)?;

        let mint_key = vesting.mint;
        let seeds = &[
            b"vesting_vault".as_ref(),
            mint_key.as_ref(),
            &[ctx.accounts.vault_authority.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_transfer = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.beneficiary_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token_interface::transfer_checked(cpi_transfer, transfer_raw, TOKEN_DECIMALS)?;

        // 통계 업데이트
        let vesting = &mut ctx.accounts.vesting_account;
        vesting.claimed_amount = vesting.claimed_amount
            .checked_add(claimable)
            .ok_or(VestingError::Overflow)?;

        let config = &mut ctx.accounts.config;
        config.total_claimed = config.total_claimed
            .checked_add(claimable)
            .ok_or(VestingError::Overflow)?;

        msg!("Vesting claim: {} GNDK by {}", claimable, vesting.beneficiary);
        Ok(())
    }

    /// Admin revoke — 미해제 물량 회수
    ///
    /// 이미 해제된(vested) 물량은 수혜자 것으로 유지
    /// 미해제 잔여분만 admin에게 반환
    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(
            ctx.accounts.admin.key() == config.admin,
            VestingError::Unauthorized
        );

        let vesting = &ctx.accounts.vesting_account;
        require!(!vesting.revoked, VestingError::AlreadyRevoked);

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // 현재 시점까지 vested 금액 계산
        let vested = calc_vested_amount(vesting, now);
        // 미해제 = 전체 - vested
        let unvested = vesting.total_amount
            .checked_sub(vested)
            .ok_or(VestingError::Overflow)?;

        if unvested > 0 {
            // Vault → Admin으로 미해제분 반환
            let transfer_raw = unvested
                .checked_mul(DECIMALS_FACTOR)
                .ok_or(VestingError::Overflow)?;

            let mint_key = vesting.mint;
            let seeds = &[
                b"vesting_vault".as_ref(),
                mint_key.as_ref(),
                &[ctx.accounts.vault_authority.bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let cpi_transfer = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.admin_ata.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            );
            token_interface::transfer_checked(cpi_transfer, transfer_raw, TOKEN_DECIMALS)?;
        }

        // Revoke 처리
        let vesting = &mut ctx.accounts.vesting_account;
        vesting.revoked = true;
        vesting.revoke_time = now;
        // total_amount을 vested로 줄임 (수혜자는 vested - claimed만 인출 가능)
        vesting.total_amount = vested;

        let config = &mut ctx.accounts.config;
        config.total_revoked = config.total_revoked
            .checked_add(unvested)
            .ok_or(VestingError::Overflow)?;

        msg!(
            "Vesting revoked: {} unvested GNDK returned, {} vested remains for {}",
            unvested, vested, vesting.beneficiary
        );
        Ok(())
    }
}

// ─── Utility ───

/// 현재 시점까지 해제된(vested) GNDK 금액 계산
fn calc_vested_amount(vesting: &VestingAccount, now: i64) -> u64 {
    if now < vesting.cliff_end {
        // Cliff 이전: 0
        return 0;
    }

    if now >= vesting.vesting_end {
        // Vesting 완료: 전액
        return vesting.total_amount;
    }

    // Linear: (경과시간 / 총 vesting 기간) × total_amount
    let elapsed = (now - vesting.cliff_end) as u64;
    let total_vest_duration = (vesting.vesting_end - vesting.cliff_end) as u64;

    if total_vest_duration == 0 {
        return vesting.total_amount;
    }

    // u128로 계산해서 overflow 방지
    let vested = (vesting.total_amount as u128)
        .checked_mul(elapsed as u128)
        .unwrap_or(0)
        .checked_div(total_vest_duration as u128)
        .unwrap_or(0);

    vested as u64
}

// ─── State ───

#[account]
pub struct VestingConfig {
    pub admin: Pubkey,                // 32
    pub mint: Pubkey,                 // 32
    pub total_vesting_created: u64,   // 8
    pub total_claimed: u64,           // 8
    pub total_revoked: u64,           // 8
    pub bump: u8,                     // 1
}
// space: 8 + 32 + 32 + 8 + 8 + 8 + 1 = 97

impl VestingConfig {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1; // 97
}

#[account]
pub struct VestingAccount {
    pub beneficiary: Pubkey,          // 32
    pub mint: Pubkey,                 // 32
    pub total_amount: u64,            // 8  — 총 물량 (GNDK 단위)
    pub claimed_amount: u64,          // 8  — 인출 완료 (GNDK 단위)
    pub start_time: i64,              // 8  — 생성 시점
    pub cliff_end: i64,               // 8  — cliff 종료 시점
    pub vesting_end: i64,             // 8  — vesting 완료 시점
    pub revoked: bool,                // 1
    pub revoke_time: i64,             // 8  — revoke 시점 (0 = not revoked)
    pub bump: u8,                     // 1
}
// space: 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 1 = 122

impl VestingAccount {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 1; // 122
}

#[account]
pub struct VaultAuthority {
    pub bump: u8,                     // 1
}

impl VaultAuthority {
    pub const SIZE: usize = 8 + 1; // 9
}

// ─── Instructions ───

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = VestingConfig::SIZE,
        seeds = [b"vesting_config"],
        bump,
    )]
    pub config: Account<'info, VestingConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        seeds = [b"vesting_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, VestingConfig>,

    #[account(
        init,
        payer = admin,
        space = VaultAuthority::SIZE,
        seeds = [b"vesting_vault", config.mint.as_ref()],
        bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    #[account(
        init,
        payer = admin,
        token::mint = mint,
        token::authority = vault_authority,
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateVesting<'info> {
    #[account(
        mut,
        seeds = [b"vesting_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, VestingConfig>,

    #[account(
        init,
        payer = admin,
        space = VestingAccount::SIZE,
        seeds = [b"vesting", beneficiary.key().as_ref()],
        bump,
    )]
    pub vesting_account: Account<'info, VestingAccount>,

    /// CHECK: 수혜자 pubkey
    pub beneficiary: UncheckedAccount<'info>,

    /// C-6 fix: vault_ata mint 검증
    #[account(mut, token::mint = mint)]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,

    /// C-6 fix: admin_ata mint 검증
    #[account(mut, token::mint = mint)]
    pub admin_ata: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"vesting_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, VestingConfig>,

    #[account(
        mut,
        seeds = [b"vesting", beneficiary.key().as_ref()],
        bump = vesting_account.bump,
    )]
    pub vesting_account: Account<'info, VestingAccount>,

    #[account(
        seeds = [b"vesting_vault", vesting_account.mint.as_ref()],
        bump = vault_authority.bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// C-6 fix: vault_ata mint 검증
    #[account(mut, token::mint = mint)]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// C-5 fix: beneficiary_ata 소유자 + mint 검증
    #[account(
        mut,
        token::mint = mint,
        token::authority = beneficiary,
    )]
    pub beneficiary_ata: InterfaceAccount<'info, TokenAccount>,

    /// 수혜자 (서명)
    pub beneficiary: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Revoke<'info> {
    #[account(
        mut,
        seeds = [b"vesting_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, VestingConfig>,

    #[account(
        mut,
        seeds = [b"vesting", vesting_account.beneficiary.as_ref()],
        bump = vesting_account.bump,
    )]
    pub vesting_account: Account<'info, VestingAccount>,

    #[account(
        seeds = [b"vesting_vault", vesting_account.mint.as_ref()],
        bump = vault_authority.bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    /// C-6 fix: vault_ata mint 검증
    #[account(mut, token::mint = mint)]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// C-6 fix: admin_ata mint 검증
    #[account(mut, token::mint = mint)]
    pub admin_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

// ─── Errors ───

#[error_code]
pub enum VestingError {
    #[msg("Unauthorized: admin or beneficiary only")]
    Unauthorized,

    #[msg("Invalid amount: must be > 0")]
    InvalidAmount,

    #[msg("Invalid duration")]
    InvalidDuration,

    #[msg("Nothing to claim yet")]
    NothingToClaim,

    #[msg("Vesting has been revoked")]
    VestingRevoked,

    #[msg("Vesting already revoked")]
    AlreadyRevoked,

    #[msg("Arithmetic overflow")]
    Overflow,
}
