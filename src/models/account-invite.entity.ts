export class AccountInvite {
  id: string;
  accountId: string;
  inviterUserId: string;
  invitedUserId?: string | null;
  invitedEmail?: string | null;
  role: 'USER' | 'ADMIN';
  hash: string;
  expiresAt: Date;
  acceptedAt?: Date | null;
  acceptedBy?: string | null;
  revoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}
