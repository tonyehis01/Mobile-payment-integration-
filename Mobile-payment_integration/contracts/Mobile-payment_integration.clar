;; Busking Payment Smart Contract
;; Allows street performers to receive payments with performance tracking

(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-invalid-amount (err u101))
(define-constant err-performer-not-found (err u102))
(define-constant err-insufficient-balance (err u103))

;; Data structures
(define-map performers 
  { performer-id: uint }
  { 
    wallet: principal,
    name: (string-ascii 50),
    instrument: (string-ascii 30),
    location: (string-ascii 100),
    total-earned: uint,
    tip-count: uint,
    active: bool
  }
)

(define-map performance-sessions
  { session-id: uint }
  {
    performer-id: uint,
    start-time: uint,
    end-time: (optional uint),
    location: (string-ascii 100),
    earnings: uint,
    tip-count: uint
  }
)

(define-map tips
  { tip-id: uint }
  {
    session-id: uint,
    tipper: principal,
    amount: uint,
    timestamp: uint,
    message: (optional (string-ascii 200))
  }
)

;; Counters
(define-data-var performer-counter uint u0)
(define-data-var session-counter uint u0)
(define-data-var tip-counter uint u0)

;; Platform fee (1% = 100 basis points)
(define-data-var platform-fee-bps uint u100)

;; Register a new performer
(define-public (register-performer (name (string-ascii 50)) 
                                 (instrument (string-ascii 30)) 
                                 (location (string-ascii 100)))
  (let ((performer-id (+ (var-get performer-counter) u1)))
    (map-set performers 
      { performer-id: performer-id }
      {
        wallet: tx-sender,
        name: name,
        instrument: instrument,
        location: location,
        total-earned: u0,
        tip-count: u0,
        active: true
      }
    )
    (var-set performer-counter performer-id)
    (ok performer-id)
  )
)

;; Start a performance session
(define-public (start-session (performer-id uint) (location (string-ascii 100)))
  (let (
    (performer (unwrap! (map-get? performers { performer-id: performer-id }) err-performer-not-found))
    (session-id (+ (var-get session-counter) u1))
  )
    (asserts! (is-eq (get wallet performer) tx-sender) err-owner-only)
    (asserts! (get active performer) err-performer-not-found)
    
    (map-set performance-sessions
      { session-id: session-id }
      {
        performer-id: performer-id,
        start-time: stacks-block-height,
        end-time: none,
        location: location,
        earnings: u0,
        tip-count: u0
      }
    )
    (var-set session-counter session-id)
    (ok session-id)
  )
)
;; Send a tip to a performer's active session
(define-public (send-tip (session-id uint) 
                        (amount uint) 
                        (message (optional (string-ascii 200))))
  (let (
    (session (unwrap! (map-get? performance-sessions { session-id: session-id }) err-performer-not-found))
    (performer-id (get performer-id session))
    (performer (unwrap! (map-get? performers { performer-id: performer-id }) err-performer-not-found))
    (platform-fee (/ (* amount (var-get platform-fee-bps)) u10000))
    (performer-amount (- amount platform-fee))
    (tip-id (+ (var-get tip-counter) u1))
  )
    (asserts! (> amount u0) err-invalid-amount)
    (asserts! (is-none (get end-time session)) err-performer-not-found) ;; Session must be active
    
    ;; Transfer STX to performer (minus platform fee)
    (try! (stx-transfer? performer-amount tx-sender (get wallet performer)))
    
    ;; Transfer platform fee to contract owner
    (try! (stx-transfer? platform-fee tx-sender contract-owner))
    
    ;; Record the tip
    (map-set tips
      { tip-id: tip-id }
      {
        session-id: session-id,
        tipper: tx-sender,
        amount: amount,
        timestamp: stacks-block-height,
        message: message
      }
    )
    
    ;; Update session earnings
    (map-set performance-sessions
      { session-id: session-id }
      (merge session {
        earnings: (+ (get earnings session) performer-amount),
        tip-count: (+ (get tip-count session) u1)
      })
    )
    
    ;; Update performer totals
    (map-set performers
      { performer-id: performer-id }
      (merge performer {
        total-earned: (+ (get total-earned performer) performer-amount),
        tip-count: (+ (get tip-count performer) u1)
      })
    )
    
    (var-set tip-counter tip-id)
    (ok tip-id)
  )
)
;; End a performance session
(define-public (end-session (session-id uint))
  (let (
    (session (unwrap! (map-get? performance-sessions { session-id: session-id }) err-performer-not-found))
    (performer-id (get performer-id session))
    (performer (unwrap! (map-get? performers { performer-id: performer-id }) err-performer-not-found))
  )
    (asserts! (is-eq (get wallet performer) tx-sender) err-owner-only)
    (asserts! (is-none (get end-time session)) err-performer-not-found) ;; Session must be active
    
    (map-set performance-sessions
      { session-id: session-id }
      (merge session { end-time: (some stacks-block-height) })
    )
    (ok true)
  )
)

;; Read-only functions for querying data

(define-read-only (get-performer (performer-id uint))
  (map-get? performers { performer-id: performer-id })
)

(define-read-only (get-session (session-id uint))
  (map-get? performance-sessions { session-id: session-id })
)

(define-read-only (get-tip (tip-id uint))
  (map-get? tips { tip-id: tip-id })
)

(define-read-only (get-performer-active-sessions (performer-id uint))
  ;; This would need to be implemented with a more complex query system
  ;; For now, returns the performer info
  (map-get? performers { performer-id: performer-id })
)

(define-read-only (get-platform-fee)
  (var-get platform-fee-bps)
)

;; Admin functions

(define-public (set-platform-fee (new-fee-bps uint))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (asserts! (<= new-fee-bps u1000) err-invalid-amount) ;; Max 10%
    (var-set platform-fee-bps new-fee-bps)
    (ok true)
  )
)

(define-public (deactivate-performer (performer-id uint))
  (let ((performer (unwrap! (map-get? performers { performer-id: performer-id }) err-performer-not-found)))
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (map-set performers
      { performer-id: performer-id }
      (merge performer { active: false })
    )
    (ok true)
  )
)