import {Address, TokenStandard} from 'znn-typescript-sdk'
import type {AccountBlockTemplate, Token} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'
import type {IssueParams} from './token-rules'

/** Issuing and administering ZTS tokens (owner-side token contract calls). */
export class TokenAdminService extends ChainService {
  private static instance: TokenAdminService | null = null

  static getInstance(): TokenAdminService {
    if (!TokenAdminService.instance) {
      TokenAdminService.instance = new TokenAdminService()
    }
    return TokenAdminService.instance
  }

  /** Tokens owned by `owner` (first 50, plenty for one account). */
  async getOwnedTokens(owner: string): Promise<Token[]> {
    await this.ensureInitialized()
    const list = await this.zenon.embedded.token.getByOwner(Address.parse(owner), 0, 50)
    return list.list ?? []
  }

  /** Costs 1 ZNN, sent with the block. */
  issue(p: IssueParams): AccountBlockTemplate {
    return this.zenon.embedded.token.issueToken(
      p.name,
      p.symbol,
      p.domain,
      p.totalSupply,
      p.maxSupply,
      p.decimals,
      p.mintable,
      p.burnable,
      p.utility
    )
  }

  mint(zts: string, amount: bigint, receiver: string): AccountBlockTemplate {
    return this.zenon.embedded.token.mint(TokenStandard.parse(zts), amount, Address.parse(receiver))
  }

  /** Sends `amount` of the token itself to the token contract. */
  burn(zts: string, amount: bigint): AccountBlockTemplate {
    return this.zenon.embedded.token.burnToken(TokenStandard.parse(zts), amount)
  }

  update(zts: string, owner: string, mintable: boolean, burnable: boolean): AccountBlockTemplate {
    return this.zenon.embedded.token.updateToken(
      TokenStandard.parse(zts),
      Address.parse(owner),
      mintable,
      burnable
    )
  }
}
