// busking-payments.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { Clarinet, Tx, Chain, Account, types } from '@hirosystems/clarinet-sdk'

const CONTRACT_NAME = 'busking-payments'

describe('Busking Payment Contract', () => {
  let chain
  let accounts
  let deployer
  let performer1
  let tipper1

  beforeEach(() => {
    chain = new Chain()
    accounts = chain.getAccounts()
    deployer = accounts.get('deployer')
    performer1 = accounts.get('wallet_1')
    tipper1 = accounts.get('wallet_2')
  })

  describe('Performer Registration', () => {
    it('should register a new performer successfully', () => {
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'register-performer',
          [
            types.ascii('John Doe'),
            types.ascii('Clarinet'),
            types.ascii('Central Park NYC')
          ],
          performer1.address
        )
      ])

      expect(block.receipts[0].result).toEqual(types.ok(types.uint(1)))
      expect(block.receipts[0].events).toHaveLength(0) // No events expected for registration
    })

    it('should get performer details after registration', () => {
      // Register performer first
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'register-performer',
          [
            types.ascii('Jane Smith'),
            types.ascii('Saxophone'),
            types.ascii('Times Square')
          ],
          performer1.address
        )
      ])

      // Get performer details
      const performerData = chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-performer',
        [types.uint(1)],
        performer1.address
      )

      expect(performerData.result).toEqual(
        types.some(types.tuple({
          wallet: types.principal(performer1.address),
          name: types.ascii('Jane Smith'),
          instrument: types.ascii('Saxophone'),
          location: types.ascii('Times Square'),
          'total-earned': types.uint(0),
          'tip-count': types.uint(0),
          active: types.bool(true)
        }))
      )
    })
  })

  describe('Performance Sessions', () => {
    beforeEach(() => {
      // Register performer before each session test
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'register-performer',
          [
            types.ascii('Bob Wilson'),
            types.ascii('Guitar'),
            types.ascii('Brooklyn Bridge')
          ],
          performer1.address
        )
      ])
    })

    it('should start a performance session', () => {
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'start-session',
          [
            types.uint(1),
            types.ascii('Washington Square Park')
          ],
          performer1.address
        )
      ])

      expect(block.receipts[0].result).toEqual(types.ok(types.uint(1)))
    })

    it('should fail to start session for non-existent performer', () => {
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'start-session',
          [
            types.uint(999), // Non-existent performer
            types.ascii('Somewhere')
          ],
          performer1.address
        )
      ])

      expect(block.receipts[0].result).toEqual(types.err(types.uint(102))) // err-performer-not-found
    })

    it('should end a performance session', () => {
      // Start session first
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'start-session',
          [types.uint(1), types.ascii('Central Park')],
          performer1.address
        )
      ])

      // End session
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'end-session',
          [types.uint(1)],
          performer1.address
        )
      ])

      expect(block.receipts[0].result).toEqual(types.ok(types.bool(true)))
    })
  })

  describe('Tip Processing', () => {
    beforeEach(() => {
      // Register performer and start session
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'register-performer',
          [
            types.ascii('Alice Cooper'),
            types.ascii('Violin'),
            types.ascii('Grand Central')
          ],
          performer1.address
        )
      ])

      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'start-session',
          [types.uint(1), types.ascii('Grand Central Station')],
          performer1.address
        )
      ])
    })

    it('should process a tip successfully', () => {
      const tipAmount = 1000000 // 1 STX in microSTX
      
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'send-tip',
          [
            types.uint(1), // session-id
            types.uint(tipAmount),
            types.some(types.ascii('Great performance!'))
          ],
          tipper1.address
        )
      ])

      expect(block.receipts[0].result).toEqual(types.ok(types.uint(1))) // tip-id
      
      // Check STX transfer events
      const transferEvents = block.receipts[0].events.filter(e => e.type === 'stx_transfer_event')
      expect(transferEvents).toHaveLength(2) // One to performer, one platform fee
    })

    it('should fail to tip with zero amount', () => {
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'send-tip',
          [
            types.uint(1),
            types.uint(0), // Invalid amount
            types.none()
          ],
          tipper1.address
        )
      ])

      expect(block.receipts[0].result).toEqual(types.err(types.uint(101))) // err-invalid-amount
    })

    it('should update performer earnings after tip', () => {
      const tipAmount = 2000000 // 2 STX
      const expectedFee = 2000 // 1% platform fee
      const expectedEarnings = tipAmount - expectedFee

      // Send tip
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'send-tip',
          [types.uint(1), types.uint(tipAmount), types.none()],
          tipper1.address
        )
      ])

      // Check updated performer data
      const performerData = chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-performer',
        [types.uint(1)],
        performer1.address
      )

      const performer = performerData.result.value.value
      expect(performer['total-earned']).toEqual(types.uint(expectedEarnings))
      expect(performer['tip-count']).toEqual(types.uint(1))
    })
  })

  describe('Platform Administration', () => {
    it('should get current platform fee', () => {
      const feeResult = chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-platform-fee',
        [],
        deployer.address
      )

      expect(feeResult.result).toEqual(types.uint(100)) // 1% = 100 basis points
    })

    it('should allow owner to update platform fee', () => {
      const newFee = 250 // 2.5%
      
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'set-platform-fee',
          [types.uint(newFee)],
          deployer.address
        )
      ])

      expect(block.receipts[0].result).toEqual(types.ok(types.bool(true)))

      // Verify fee was updated
      const feeResult = chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-platform-fee',
        [],
        deployer.address
      )
      expect(feeResult.result).toEqual(types.uint(newFee))
    })

    it('should reject fee update from non-owner', () => {
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'set-platform-fee',
          [types.uint(200)],
          performer1.address // Not the contract owner
        )
      ])

      expect(block.receipts[0].result).toEqual(types.err(types.uint(100))) // err-owner-only
    })

    it('should deactivate performer by owner', () => {
      // Register performer first
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'register-performer',
          [
            types.ascii('Test Performer'),
            types.ascii('Piano'),
            types.ascii('Test Location')
          ],
          performer1.address
        )
      ])

      // Deactivate performer
      const block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'deactivate-performer',
          [types.uint(1)],
          deployer.address
        )
      ])

      expect(block.receipts[0].result).toEqual(types.ok(types.bool(true)))

      // Verify performer is deactivated
      const performerData = chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-performer',
        [types.uint(1)],
        deployer.address
      )
      
      expect(performerData.result.value.value.active).toEqual(types.bool(false))
    })
  })

  describe('Data Queries', () => {
    it('should return none for non-existent performer', () => {
      const result = chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-performer',
        [types.uint(999)],
        deployer.address
      )

      expect(result.result).toEqual(types.none())
    })

    it('should return session data', () => {
      // Setup: register performer and start session
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'register-performer',
          [types.ascii('Session Tester'), types.ascii('Drums'), types.ascii('Test Place')],
          performer1.address
        )
      ])

      chain.mineBlock([
        Tx.contractCall(
          CONTRACT_NAME,
          'start-session',
          [types.uint(1), types.ascii('Concert Hall')],
          performer1.address
        )
      ])

      const sessionData = chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-session',
        [types.uint(1)],
        deployer.address
      )

      const session = sessionData.result.value.value
      expect(session['performer-id']).toEqual(types.uint(1))
      expect(session.location).toEqual(types.ascii('Concert Hall'))
      expect(session.earnings).toEqual(types.uint(0))
      expect(session['end-time']).toEqual(types.none())
    })
  })
})