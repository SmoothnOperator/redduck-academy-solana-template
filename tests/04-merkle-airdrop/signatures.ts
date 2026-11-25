import { BN } from "@coral-xyz/anchor";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { toBN } from "../helpers";

export const buildClaimSignatureIx = (
  signer: Keypair,
  claimant: PublicKey,
  amount: BN,
  programId: PublicKey,
): TransactionInstruction => {
  const message = Buffer.concat([
    claimant.toBuffer(),
    toBN(amount).toArrayLike(Buffer, "le", 8),
    programId.toBuffer(),
  ]);

  return Ed25519Program.createInstructionWithPrivateKey({
    privateKey: signer.secretKey,
    message,
  });
};
