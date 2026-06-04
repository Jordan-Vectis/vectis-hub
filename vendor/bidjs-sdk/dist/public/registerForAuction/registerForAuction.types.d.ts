import { MetaModel } from '../model/model.types';
import { CurrencyModel } from '../../types/common';
export interface RegisterForAuctionRequest {
    agreedTerms: boolean;
    auctionUuid: string;
    referer: string;
    spendingLimit: number;
    userId: number;
}
export interface RegisterForAuctionResponse {
    title: string;
    content: string;
    status: string;
    paddleNumber: number;
    referer: string;
}
export interface RegistrationPageResponse {
    alreadyRegistered: boolean;
    spendingLimitRequired: boolean;
    auctioneerCentric: boolean;
    auctionId: number;
    metaModel: MetaModel;
    auctionTerms: string;
    auctionTitle: string;
    alreadyRegisteredText: string | null;
    auctioneerLogo: string | null;
    auctioneerName: string;
    registrationText: string;
    referer: string;
    currency: CurrencyModel;
}
//# sourceMappingURL=registerForAuction.types.d.ts.map