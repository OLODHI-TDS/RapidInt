/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects the system from cascading failures by tracking error rates per provider
 * and temporarily disabling failing providers with exponential backoff.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Provider disabled due to high failure rate, requests fail fast
 * - HALF_OPEN: Testing if provider has recovered, limited requests allowed
 *
 * Features:
 * - Per-provider circuit breakers (legacy, salesforce)
 * - Configurable failure thresholds and timeouts
 * - Exponential backoff for recovery attempts
 * - Health check integration
 * - Event emission for monitoring
 */

const EventEmitter = require('events');

// Circuit breaker states
const State = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

/**
 * Circuit Breaker Configuration
 */
const DEFAULT_CONFIG = {
  // Failure threshold to open circuit (percentage)
  failureThreshold: 50, // Open circuit if 50% of requests fail

  // Minimum number of requests before calculating failure rate
  minimumRequests: 10,

  // Time window for tracking failures (milliseconds)
  windowSize: 60000, // 1 minute

  // Time to wait before attempting recovery (milliseconds)
  openTimeout: 30000, // 30 seconds

  // Maximum timeout for exponential backoff (milliseconds)
  maxOpenTimeout: 300000, // 5 minutes

  // Number of successful requests needed in HALF_OPEN to close circuit
  successThreshold: 3,

  // Exponential backoff multiplier
  backoffMultiplier: 2,

  // Enable detailed logging
  enableLogging: true
};

/**
 * Circuit Breaker for a single provider
 */
class CircuitBreaker extends EventEmitter {
  constructor(provider, config = {}) {
    super();

    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Circuit state
    this.state = State.CLOSED;
    this.failures = [];
    this.successes = [];
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;

    // Timeout tracking
    this.openedAt = null;
    this.currentTimeout = this.config.openTimeout;
    this.nextAttemptTime = null;

    // Statistics
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      circuitOpens: 0,
      circuitCloses: 0,
      lastFailure: null,
      lastSuccess: null
    };

    this.log('Circuit breaker initialized', { state: this.state });
  }

  /**
   * Execute a request through the circuit breaker
   *
   * @param {Function} fn - Async function to execute
   * @returns {Promise} - Result of the function
   */
  async execute(fn) {
    // Check if circuit is open
    if (this.state === State.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        const waitTime = this.nextAttemptTime - Date.now();
        this.log('Circuit is OPEN, failing fast', {
          waitTime: `${Math.round(waitTime / 1000)}s`
        });

        const error = new Error(`Circuit breaker is OPEN for provider: ${this.provider}`);
        error.circuitBreakerOpen = true;
        error.nextAttemptTime = this.nextAttemptTime;
        error.provider = this.provider;
        throw error;
      } else {
        // Timeout expired, try half-open state
        this.transitionTo(State.HALF_OPEN);
      }
    }

    this.stats.totalRequests++;

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess() {
    const now = Date.now();

    this.successes.push(now);
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.stats.totalSuccesses++;
    this.stats.lastSuccess = new Date().toISOString();

    // Clean old successes outside window
    this.cleanWindow(this.successes);

    this.log('Request succeeded', {
      consecutiveSuccesses: this.consecutiveSuccesses,
      state: this.state
    });

    // Handle state transitions
    if (this.state === State.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo(State.CLOSED);
      }
    }
  }

  /**
   * Record a failed request
   *
   * @param {Error} error - The error that occurred
   */
  recordFailure(error) {
    const now = Date.now();

    this.failures.push(now);
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.stats.totalFailures++;
    this.stats.lastFailure = new Date().toISOString();

    // Clean old failures outside window
    this.cleanWindow(this.failures);

    this.log('Request failed', {
      error: error.message,
      consecutiveFailures: this.consecutiveFailures,
      state: this.state
    });

    // Check if we should open the circuit
    if (this.state === State.HALF_OPEN) {
      // Any failure in half-open state opens the circuit again
      this.transitionTo(State.OPEN);
    } else if (this.state === State.CLOSED) {
      // Check failure threshold
      if (this.shouldOpenCircuit()) {
        this.transitionTo(State.OPEN);
      }
    }
  }

  /**
   * Determine if circuit should be opened based on failure rate
   *
   * @returns {boolean} - True if circuit should open
   */
  shouldOpenCircuit() {
    const totalRequests = this.failures.length + this.successes.length;

    // Not enough requests to make a decision
    if (totalRequests < this.config.minimumRequests) {
      return false;
    }

    const failureRate = (this.failures.length / totalRequests) * 100;

    this.log('Evaluating circuit health', {
      totalRequests,
      failures: this.failures.length,
      successes: this.successes.length,
      failureRate: `${failureRate.toFixed(2)}%`,
      threshold: `${this.config.failureThreshold}%`
    });

    return failureRate >= this.config.failureThreshold;
  }

  /**
   * Transition to a new state
   *
   * @param {string} newState - The new state
   */
  transitionTo(newState) {
    const oldState = this.state;

    if (oldState === newState) {
      return;
    }

    this.state = newState;

    this.log('State transition', {
      from: oldState,
      to: newState
    });

    // State-specific logic
    switch (newState) {
      case State.OPEN:
        this.handleOpenState();
        break;

      case State.HALF_OPEN:
        this.handleHalfOpenState();
        break;

      case State.CLOSED:
        this.handleClosedState();
        break;
    }

    // Emit state change event
    this.emit('stateChange', {
      provider: this.provider,
      from: oldState,
      to: newState,
      timestamp: new Date().toISOString(),
      stats: this.getStats()
    });
  }

  /**
   * Handle OPEN state logic
   */
  handleOpenState() {
    this.openedAt = Date.now();
    this.nextAttemptTime = this.openedAt + this.currentTimeout;
    this.stats.circuitOpens++;

    this.log('Circuit OPENED', {
      timeout: `${this.currentTimeout / 1000}s`,
      nextAttempt: new Date(this.nextAttemptTime).toISOString()
    });

    // Increase timeout for next open (exponential backoff)
    this.currentTimeout = Math.min(
      this.currentTimeout * this.config.backoffMultiplier,
      this.config.maxOpenTimeout
    );

    // Emit open event
    this.emit('open', {
      provider: this.provider,
      timeout: this.currentTimeout,
      nextAttemptTime: this.nextAttemptTime,
      stats: this.getStats()
    });
  }

  /**
   * Handle HALF_OPEN state logic
   */
  handleHalfOpenState() {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;

    this.log('Circuit HALF_OPEN', {
      message: 'Testing provider recovery'
    });

    this.emit('halfOpen', {
      provider: this.provider,
      stats: this.getStats()
    });
  }

  /**
   * Handle CLOSED state logic
   */
  handleClosedState() {
    // Reset timeout on successful recovery
    this.currentTimeout = this.config.openTimeout;
    this.openedAt = null;
    this.nextAttemptTime = null;
    this.consecutiveFailures = 0;
    this.stats.circuitCloses++;

    this.log('Circuit CLOSED', {
      message: 'Provider recovered'
    });

    this.emit('close', {
      provider: this.provider,
      stats: this.getStats()
    });
  }

  /**
   * Remove entries outside the time window
   *
   * @param {Array} array - Array of timestamps to clean
   */
  cleanWindow(array) {
    const cutoff = Date.now() - this.config.windowSize;
    while (array.length > 0 && array[0] < cutoff) {
      array.shift();
    }
  }

  /**
   * Check if provider is available
   *
   * @returns {boolean} - True if requests can be sent
   */
  isAvailable() {
    if (this.state === State.CLOSED || this.state === State.HALF_OPEN) {
      return true;
    }

    if (this.state === State.OPEN && Date.now() >= this.nextAttemptTime) {
      return true;
    }

    return false;
  }

  /**
   * Get circuit breaker statistics
   *
   * @returns {object} - Statistics object
   */
  getStats() {
    const totalRequests = this.failures.length + this.successes.length;
    const failureRate = totalRequests > 0
      ? (this.failures.length / totalRequests) * 100
      : 0;

    return {
      provider: this.provider,
      state: this.state,
      totalRequests: this.stats.totalRequests,
      totalSuccesses: this.stats.totalSuccesses,
      totalFailures: this.stats.totalFailures,
      windowRequests: totalRequests,
      windowSuccesses: this.successes.length,
      windowFailures: this.failures.length,
      failureRate: `${failureRate.toFixed(2)}%`,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      circuitOpens: this.stats.circuitOpens,
      circuitCloses: this.stats.circuitCloses,
      lastFailure: this.stats.lastFailure,
      lastSuccess: this.stats.lastSuccess,
      nextAttemptTime: this.nextAttemptTime ? new Date(this.nextAttemptTime).toISOString() : null,
      isAvailable: this.isAvailable()
    };
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset() {
    this.state = State.CLOSED;
    this.failures = [];
    this.successes = [];
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.currentTimeout = this.config.openTimeout;
    this.openedAt = null;
    this.nextAttemptTime = null;

    this.log('Circuit breaker reset');

    this.emit('reset', {
      provider: this.provider,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Force circuit to specific state (for testing/admin)
   *
   * @param {string} state - State to force
   */
  forceState(state) {
    if (!Object.values(State).includes(state)) {
      throw new Error(`Invalid state: ${state}`);
    }

    this.transitionTo(state);
  }

  /**
   * Log message if logging is enabled
   */
  log(message, data = {}) {
    if (this.config.enableLogging) {
      console.log(`[CircuitBreaker:${this.provider}] ${message}`, data);
    }
  }
}

/**
 * Circuit Breaker Manager - Manages multiple circuit breakers
 * SECURITY FIX (HIGH-002): Organization-scoped circuit breakers to prevent cascading failures
 */
class CircuitBreakerManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.breakers = new Map();
    this.config = config;
  }

  /**
   * Get or create circuit breaker for a provider with organization isolation
   *
   * @param {string} provider - Provider name ('legacy' or 'salesforce')
   * @param {string} organizationId - Organization identifier (optional for backwards compatibility)
   * @returns {CircuitBreaker} - Circuit breaker instance
   */
  getBreaker(provider, organizationId = null) {
    // Create organization-scoped key: "orgId:provider" or just "provider" for backwards compatibility
    const breakerKey = organizationId ? `${organizationId}:${provider}` : provider;

    if (!this.breakers.has(breakerKey)) {
      const breaker = new CircuitBreaker(breakerKey, this.config);

      // Forward events to manager
      breaker.on('stateChange', (event) => this.emit('stateChange', event));
      breaker.on('open', (event) => this.emit('open', event));
      breaker.on('halfOpen', (event) => this.emit('halfOpen', event));
      breaker.on('close', (event) => this.emit('close', event));

      this.breakers.set(breakerKey, breaker);
    }

    return this.breakers.get(breakerKey);
  }

  /**
   * Execute request through appropriate circuit breaker with organization isolation
   *
   * @param {string} provider - Provider name ('legacy' or 'salesforce')
   * @param {string} organizationId - Organization identifier (optional)
   * @param {Function} fn - Async function to execute
   * @returns {Promise} - Result of the function
   */
  async execute(provider, organizationId, fn) {
    // Handle backwards compatibility: if organizationId is actually a function, shift parameters
    if (typeof organizationId === 'function') {
      fn = organizationId;
      organizationId = null;
    }

    const breaker = this.getBreaker(provider, organizationId);
    return breaker.execute(fn);
  }

  /**
   * Get statistics for all circuit breakers
   *
   * @returns {object} - Statistics for all providers
   */
  getAllStats() {
    const stats = {};

    for (const [provider, breaker] of this.breakers) {
      stats[provider] = breaker.getStats();
    }

    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Check if a provider is available for an organization
   *
   * @param {string} provider - Provider name
   * @param {string} organizationId - Organization identifier (optional)
   * @returns {boolean} - True if available
   */
  isProviderAvailable(provider, organizationId = null) {
    const breakerKey = organizationId ? `${organizationId}:${provider}` : provider;
    const breaker = this.breakers.get(breakerKey);
    return breaker ? breaker.isAvailable() : true; // If no breaker exists, assume available
  }
}

// Export singleton instance
const manager = new CircuitBreakerManager();

module.exports = {
  CircuitBreaker,
  CircuitBreakerManager,
  State,
  manager // Singleton instance for shared use
};
