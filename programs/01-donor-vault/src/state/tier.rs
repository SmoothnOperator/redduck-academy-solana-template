use anchor_lang::prelude::*;

/// Loyalty tier of a donor. The variant order is the on-chain/return encoding —
/// don't change it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tier {
    None,
    Bronze,
    Silver,
    Gold,
    Platinum,
}

impl Tier {
    pub fn from_total(total: u64) -> Self {
        if total == 0 {
            Tier::None
        } else if total < 100_000_000 {
            Tier::Bronze
        } else if total < 1_000_000_000 {
            Tier::Silver
        } else if total < 10_000_000_000 {
            Tier::Gold
        } else {
            Tier::Platinum
        }
    }
}
