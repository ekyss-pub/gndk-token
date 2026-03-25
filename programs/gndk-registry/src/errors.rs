use anchor_lang::prelude::*;

// ═══════════════════════════════════════════════════════════════
// GNDK Registry — Error Codes
// ═══════════════════════════════════════════════════════════════

#[error_code]
pub enum GndkError {
    #[msg("Unauthorized: admin or oracle only")]
    Unauthorized,

    #[msg("Program is paused")]
    ProgramPaused,

    #[msg("Module is paused")]
    ModulePaused,

    #[msg("Module is inactive")]
    ModuleInactive,

    #[msg("L2E annual limit exceeded (Dynamic Halving cap)")]
    L2EAnnualLimitExceeded,

    #[msg("D2E annual limit exceeded")]
    D2EAnnualLimitExceeded,

    #[msg("Daily limit exceeded for module")]
    DailyLimitExceeded,

    #[msg("Admin annual limit exceeded")]
    AdminAnnualLimitExceeded,

    #[msg("Module name too long (max 32 bytes)")]
    NameTooLong,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Invalid phase: already at maximum")]
    InvalidPhase,

    #[msg("Phase can only advance forward")]
    PhaseCannotReverse,

    #[msg("Pool type mismatch")]
    PoolTypeMismatch,

    #[msg("Mint does not match config")]
    MintMismatch,
}
