import JSBI from "jsbi";
import assert from "assert";
import { TickManager } from "../manager/TickManager";
import { PositionManager } from "../manager/PositionManager";
import { Position } from "../model/Position";
import { Tick } from "../model/Tick";
import { TickMath } from "../util/TickMath";
import { StepComputations } from "../entity/StepComputations";
import { ZERO, ONE, NEGATIVE_ONE, Q128 } from "../enum/InternalConstants";
import { SwapMath } from "../util/SwapMath";
import { LiquidityMath } from "../util/LiquidityMath";
import { FullMath } from "../util/FullMath";
import { FeeAmount } from "../enum/FeeAmount";

export class CorePool {
  readonly token0: string;
  readonly token1: string;
  readonly fee: FeeAmount;
  readonly tickSpacing: number;
  readonly maxLiquidityPerTick: JSBI;
  private _token0Balance: JSBI;
  private _token1Balance: JSBI;
  private _sqrtPriceX96: JSBI;
  private _liquidity: JSBI;
  private _tickCurrent: number;
  private _feeGrowthGlobal0X128: JSBI;
  private _feeGrowthGlobal1X128: JSBI;
  private _tickManager: TickManager;
  private _positionManager: PositionManager;

  constructor(
    token0: string,
    token1: string,
    fee: FeeAmount,
    tickSpacing: number,
    token0Balance: JSBI = JSBI.BigInt(0),
    token1Balance: JSBI = JSBI.BigInt(0),
    sqrtPriceX96: JSBI = JSBI.BigInt(0),
    liquidity: JSBI = JSBI.BigInt(0),
    tickCurrent: number = 0,
    feeGrowthGlobal0X128: JSBI = JSBI.BigInt(0),
    feeGrowthGlobal1X128: JSBI = JSBI.BigInt(0),
    tickManager: TickManager = new TickManager(),
    positionManager: PositionManager = new PositionManager()
  ) {
    this.token0 = token0;
    this.token1 = token1;
    this.fee = fee;
    this.tickSpacing = tickSpacing;
    this.maxLiquidityPerTick =
      TickMath.tickSpacingToMaxLiquidityPerTick(tickSpacing);
    this._token0Balance = token0Balance;
    this._token1Balance = token1Balance;
    this._sqrtPriceX96 = sqrtPriceX96;
    this._liquidity = liquidity;
    this._tickCurrent = tickCurrent;
    this._feeGrowthGlobal0X128 = feeGrowthGlobal0X128;
    this._feeGrowthGlobal1X128 = feeGrowthGlobal1X128;
    this._tickManager = tickManager;
    this._positionManager = positionManager;
  }

  public get token0Balance(): JSBI {
    return this._token0Balance;
  }

  public get token1Balance(): JSBI {
    return this._token1Balance;
  }

  public get sqrtPriceX96(): JSBI {
    return this._sqrtPriceX96;
  }

  public get liquidity(): JSBI {
    return this._liquidity;
  }

  public get tickCurrent(): number {
    return this._tickCurrent;
  }

  public get feeGrowthGlobal0X128(): JSBI {
    return this._feeGrowthGlobal0X128;
  }

  public get feeGrowthGlobal1X128(): JSBI {
    return this._feeGrowthGlobal1X128;
  }

  public get tickManager(): TickManager {
    return this._tickManager;
  }

  public get positionManager(): PositionManager {
    return this._positionManager;
  }

  initialize(sqrtPriceX96: JSBI) {
    // TODO
    this._tickCurrent = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
    this._sqrtPriceX96 = sqrtPriceX96;
  }

  mint(
    recipient: string,
    tickLower: number,
    tickUpper: number,
    amount: JSBI
  ): { amount0: JSBI; amount1: JSBI } {
    // TODO
    return {
      amount0: JSBI.BigInt(0),
      amount1: JSBI.BigInt(0),
    };
  }

  burn(
    owner: string,
    tickLower: number,
    tickUpper: number,
    amount: JSBI
  ): { amount0: JSBI; amount1: JSBI } {
    // TODO
    return {
      amount0: JSBI.BigInt(0),
      amount1: JSBI.BigInt(0),
    };
  }

  collect(
    recipient: string,
    tickLower: number,
    tickUpper: number,
    amount0Requested: JSBI,
    amount1Requested: JSBI
  ): { amount0: JSBI; amount1: JSBI } {
    // TODO
    return {
      amount0: JSBI.BigInt(0),
      amount1: JSBI.BigInt(0),
    };
  }

  swap(
    zeroForOne: boolean,
    amountSpecified: JSBI,
    sqrtPriceLimitX96: JSBI
  ): { amount0: JSBI; amount1: JSBI } {
    if (!sqrtPriceLimitX96)
      sqrtPriceLimitX96 = zeroForOne
        ? JSBI.add(TickMath.MIN_SQRT_RATIO, ONE)
        : JSBI.subtract(TickMath.MAX_SQRT_RATIO, ONE);

    if (zeroForOne) {
      assert(
        JSBI.greaterThan(sqrtPriceLimitX96, TickMath.MIN_SQRT_RATIO),
        "RATIO_MIN"
      );
      assert(
        JSBI.lessThan(sqrtPriceLimitX96, this.sqrtPriceX96),
        "RATIO_CURRENT"
      );
    } else {
      assert(
        JSBI.lessThan(sqrtPriceLimitX96, TickMath.MAX_SQRT_RATIO),
        "RATIO_MAX"
      );
      assert(
        JSBI.greaterThan(sqrtPriceLimitX96, this.sqrtPriceX96),
        "RATIO_CURRENT"
      );
    }

    const exactInput = JSBI.greaterThanOrEqual(amountSpecified, ZERO);

    // keep track of swap state

    const state = {
      amountSpecifiedRemaining: amountSpecified,
      amountCalculated: ZERO,
      sqrtPriceX96: this.sqrtPriceX96,
      tick: this.tickCurrent,
      liquidity: this.liquidity,
      feeGrowthGlobalX128: zeroForOne
        ? this._feeGrowthGlobal0X128
        : this._feeGrowthGlobal1X128,
    };

    // start swap while loop
    while (
      JSBI.notEqual(state.amountSpecifiedRemaining, ZERO) &&
      state.sqrtPriceX96 != sqrtPriceLimitX96
    ) {
      let step: StepComputations = {
        sqrtPriceStartX96: ZERO,
        tickNext: 0,
        initialized: false,
        sqrtPriceNextX96: ZERO,
        amountIn: ZERO,
        amountOut: ZERO,
        feeAmount: ZERO,
      };
      step.sqrtPriceStartX96 = state.sqrtPriceX96;

      // because each iteration of the while loop rounds, we can't optimize this code (relative to the smart contract)
      // by simply traversing to the next available tick, we instead need to exactly replicate
      // tickBitmap.nextInitializedTickWithinOneWord
      ({ nextTick: step.tickNext, initialized: step.initialized } =
        this.tickManager.getNextInitializedTick(
          state.tick,
          this.tickSpacing,
          zeroForOne
        ));

      if (step.tickNext < TickMath.MIN_TICK) {
        step.tickNext = TickMath.MIN_TICK;
      } else if (step.tickNext > TickMath.MAX_TICK) {
        step.tickNext = TickMath.MAX_TICK;
      }

      step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);
      [state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount] =
        SwapMath.computeSwapStep(
          state.sqrtPriceX96,
          (
            zeroForOne
              ? JSBI.lessThan(step.sqrtPriceNextX96, sqrtPriceLimitX96)
              : JSBI.greaterThan(step.sqrtPriceNextX96, sqrtPriceLimitX96)
          )
            ? sqrtPriceLimitX96
            : step.sqrtPriceNextX96,
          state.liquidity,
          state.amountSpecifiedRemaining,
          this.fee
        );

      if (exactInput) {
        state.amountSpecifiedRemaining = JSBI.subtract(
          state.amountSpecifiedRemaining,
          JSBI.add(step.amountIn, step.feeAmount)
        );
        state.amountCalculated = JSBI.subtract(
          state.amountCalculated,
          step.amountOut
        );
      } else {
        state.amountSpecifiedRemaining = JSBI.add(
          state.amountSpecifiedRemaining,
          step.amountOut
        );
        state.amountCalculated = JSBI.add(
          state.amountCalculated,
          JSBI.add(step.amountIn, step.feeAmount)
        );
      }

      if (JSBI.greaterThan(state.liquidity, ZERO))
        state.feeGrowthGlobalX128 = JSBI.add(
          state.feeGrowthGlobalX128,
          FullMath.mulDiv(step.feeAmount, Q128, state.liquidity)
        );

      if (JSBI.equal(state.sqrtPriceX96, step.sqrtPriceNextX96)) {
        // if the tick is initialized, run the tick transition
        if (step.initialized) {
          let nextTick = this.tickManager.get(step.tickNext);
          let liquidityNet = nextTick.cross(
            zeroForOne ? state.feeGrowthGlobalX128 : this._feeGrowthGlobal0X128,
            zeroForOne ? this._feeGrowthGlobal1X128 : state.feeGrowthGlobalX128
          );

          // if we're moving leftward, we interpret liquidityNet as the opposite sign
          // safe because liquidityNet cannot be type(int128).min
          if (zeroForOne)
            liquidityNet = JSBI.multiply(liquidityNet, NEGATIVE_ONE);

          state.liquidity = LiquidityMath.addDelta(
            state.liquidity,
            liquidityNet
          );
        }

        state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext;
      } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
        // recompute unless we're on a lower tick boundary (i.e. already transitioned ticks), and haven't moved
        state.tick = TickMath.getTickAtSqrtRatio(state.sqrtPriceX96);
      }
    }

    this._sqrtPriceX96 = state.sqrtPriceX96;
    if (state.tick != this.tickCurrent) this._tickCurrent = state.tick;
    if (state.liquidity != this._liquidity) this._liquidity = state.liquidity;

    // update fee growth global
    if (zeroForOne) {
      this._feeGrowthGlobal0X128 = state.feeGrowthGlobalX128;
    } else {
      this._feeGrowthGlobal1X128 = state.feeGrowthGlobalX128;
    }

    let [amount0, amount1] =
      zeroForOne == exactInput
        ? [
            JSBI.subtract(amountSpecified, state.amountSpecifiedRemaining),
            state.amountCalculated,
          ]
        : [
            state.amountCalculated,
            JSBI.subtract(amountSpecified, state.amountSpecifiedRemaining),
          ];

    return { amount0, amount1 };
  }

  private modifyPosition(
    owner: string,
    tickLower: number,
    tickUpper: number,
    liquidityDelta: JSBI
  ): { position: Position; amount0: JSBI; amount1: JSBI } {
    // TODO
    return {
      position: new Position(),
      amount0: JSBI.BigInt(0),
      amount1: JSBI.BigInt(0),
    };
  }

  private updatePosition(
    owner: string,
    tickLower: number,
    tickUpper: number,
    liquidityDelta: JSBI
  ): Position {
    // TODO
    return new Position();
  }

  getTick(tick: number): Tick {
    return this.tickManager.get(tick);
  }

  getPosition(owner: string, tickLower: number, tickUpper: number): Position {
    return this.positionManager.get(
      PositionManager.getKey(owner, tickLower, tickUpper)
    );
  }

  toString(): string {
    return `
    Current State:
        token0Balance: ${this.token0Balance.toString()}
        token1Balance: ${this.token1Balance.toString()}
        sqrtPriceX96: ${this.sqrtPriceX96.toString()}
        liquidity: ${this.liquidity.toString()}
        tickCurrent: ${this.tickCurrent}
        feeGrowthGlobal0X128: ${this.feeGrowthGlobal0X128.toString()}
        feeGrowthGlobal1X128: ${this.feeGrowthGlobal1X128.toString()}
    `;
  }
}
