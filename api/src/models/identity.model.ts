import { ObjectId } from "mongodb";

export interface IdentityDoc {
  _id: ObjectId;
  applicantId: ObjectId;
  alias: string;
  encryptedInstagram: string;
  encryptionIv: string;
  encryptionTag: string;
  /** HMAC-SHA256 of normalized handle — enables O(1) duplicate detection without decryption */
  instagramHash: string;
  /** Additive — pre-existing identities have no name on record; reveal falls
   *  back to null for those, no backfill needed. Encrypted with its own
   *  fresh IV, never reusing encryptionIv (AES-GCM nonce reuse breaks
   *  confidentiality guarantees even within the same document). */
  encryptedFullName?: string;
  fullNameIv?: string;
  fullNameTag?: string;
  createdAt: Date;
}
