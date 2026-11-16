// ============================================================================
//  AI BETTING QUANT PRO - VALUE EVALUATOR
//  Versione: 7.1 QUANT ANALYTICS ENGINE - STRICT PORTFOLIO/CLV (Active Calibration & Feedback Loop)
//  Sport: CALCIO + TENNIS
//
//  Features:
//  - Expected ROI & Yield
//  - Brier Skill Score & Baseline Comparison
//  - Wilson Interval Calibration Buckets
//  - Active Probability Correction
//  - Operational Reliability Decision (NORMAL, REDUCE, SUSPEND)
// ============================================================================

class ValueEvaluator {

    // =========================================================================
    // BASE HELPERS
    // =========================================================================

    clamp(value, min, max) {
        if (isNaN(value)) return min;
        return Math.max(min, Math.min(max, value));
    }

    safeNumber(value, fallback = 0) {
        // AUDIT04: complete decimal/scientific notation, no coercion of booleans/objects.
        if (typeof value !== 'number' && (typeof value !== 'string' ||
            !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))) return fallback;
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    average(arr = [], fallback = 0) {
        if (!Array.isArray(arr) || arr.length === 0) return fallback;
        const clean = arr.map(v => this.safeNumber(v, null)).filter(v => v !== null);
        if (clean.length === 0) return fallback;
        return clean.reduce((a, b) => a + b, 0) / clean.length;
    }

    stdDev(arr = []) {
        if (!Array.isArray(arr) || arr.length < 2) return 0;
        const mean = this.average(arr);
        const variance = arr.reduce((sum, val) => {
            return sum + Math.pow(val - mean, 2);
        }, 0) / arr.length;
        return Math.sqrt(variance);
    }

    // =========================================================================
    // SETTLED BET / SPORT / RESULT NORMALIZATION
    // =========================================================================

    normalizeStatus(bet = {}) {
        return String(
            bet.status ||
            bet.result ||
            bet.outcome ||
            ''
        ).trim().toUpperCase();
    }

    isSettledBet(bet = {}) {
        const status = this.normalizeStatus(bet);
        return (
            status === 'WIN' ||
            status === 'WON' ||
            status === 'LOST' ||
            status === 'LOSS' ||
            status === 'LOSE' ||
            status === 'PUSH' ||
            status === 'VOID'
        );
    }

    isWinningBet(bet = {}) {
        const status = this.normalizeStatus(bet);
        return status === 'WIN' || status === 'WON';
    }

    isPushOrVoid(bet = {}) {
        const status = this.normalizeStatus(bet);
        return status === 'PUSH' || status === 'VOID';
    }

    extractProbability(bet = {}) {
        const probability = this.safeNumber(
            bet.model_probability ??
            bet.probability ??
            bet.estimated_prob ??
            bet.estimatedProb ??
            bet.predicted_probability ??
            bet.predictedProbability,
            null
        );

        if (probability === null) return null;
        return this.clamp(probability, 1, 99);
    }

    normalizeSportType(bet = {}) {
        const raw = String(
            bet.sport_type ||
            bet.sport ||
            bet.league ||
            bet.competition ||
            bet.bet_type ||
            bet.strategy_tag ||
            ''
        ).toLowerCase();

        if (raw.includes('tennis') || raw.includes('atp') || raw.includes('wta')) {
            return 'tennis';
        }

        if (
            raw.includes('calcio') || raw.includes('football') || raw.includes('soccer') ||
            raw.includes('serie a') || raw.includes('serie b') || raw.includes('liga') ||
            raw.includes('premier') || raw.includes('bundesliga') || raw.includes('ligue')
        ) {
            return 'football';
        }

        return 'unknown';
    }

    getBrierQuality(avgBrier) {
        avgBrier = this.safeNumber(avgBrier, 1);
        if (avgBrier <= 0.16) return "ELITE";
        if (avgBrier <= 0.19) return "VERY_GOOD";
        if (avgBrier <= 0.22) return "GOOD";
        if (avgBrier <= 0.245) return "ACCEPTABLE";
        if (avgBrier <= 0.27) return "WEAK";
        return "POOR";
    }

    getCalibrationQuality(weightedCalibrationError, maxBucketError = 0) {
        weightedCalibrationError = this.safeNumber(weightedCalibrationError, 99);
        maxBucketError = this.safeNumber(maxBucketError, 99);

        if (weightedCalibrationError <= 3 && maxBucketError <= 6) return "ELITE";
        if (weightedCalibrationError <= 5 && maxBucketError <= 9) return "GOOD";
        if (weightedCalibrationError <= 7.5 && maxBucketError <= 12) return "ACCEPTABLE";
        if (weightedCalibrationError <= 10) return "WEAK";
        return "POOR";
    }

    getReliabilityDecision({ brier = 1, calibrationError = 99, sampleSize = 0, clv = 0 } = {}) {
        brier = this.safeNumber(brier, 1);
        calibrationError = this.safeNumber(calibrationError, 99);
        sampleSize = this.safeNumber(sampleSize, 0);
        clv = this.safeNumber(clv, 0);

        if (sampleSize < 30) {
            return {
                level: "NO_BET_OR_MICRO_STAKE",
                stakeMultiplier: 0.25,
                reason: "Campione insufficiente per validare la calibrazione"
            };
        }

        if (brier > 0.27 || calibrationError > 10) {
            return {
                level: "SUSPEND",
                stakeMultiplier: 0,
                reason: "Brier/calibrazione fuori soglia professionale"
            };
        }

        if (brier > 0.245 || calibrationError > 7.5 || clv < 0) {
            return {
                level: "REDUCE",
                stakeMultiplier: 0.5,
                reason: "Attendibilità debole: ridurre esposizione"
            };
        }

        if (brier <= 0.22 && calibrationError <= 5 && clv >= 0.5) {
            return {
                level: "NORMAL",
                stakeMultiplier: 1,
                reason: "Metriche compatibili con utilizzo operativo"
            };
        }

        return {
            level: "CAUTION",
            stakeMultiplier: 0.75,
            reason: "Metriche accettabili ma non ancora forti"
        };
    }

    // =========================================================================
    // EXPECTED ROI ENGINE
    // =========================================================================

    calculateExpectedROI(oddBack, oddLayTarget, probDropPct, commissionPct = 2.0) {
        if (!oddBack || !oddLayTarget || oddLayTarget >= oddBack) return 0.0;
        const grossProfitMultiplier = (oddBack / oddLayTarget) - 1;
        const netProfitMultiplier = grossProfitMultiplier * (1 - (commissionPct / 100));
        const stopLossOdd = oddBack + 0.15;
        const lossMultiplier = (oddBack / stopLossOdd) - 1;
        const pDrop = probDropPct / 100;
        const pDrift = 1 - pDrop;
        const expectedRoiDecimal = (pDrop * netProfitMultiplier) + (pDrift * lossMultiplier);
        return parseFloat((expectedRoiDecimal * 100).toFixed(2));
    }

    // =========================================================================
    // BRIER SCORE & SKILL
    // =========================================================================

    calculateBrierScore(probabilityPct, actualResult) {
        const p = this.clamp(this.safeNumber(probabilityPct, 0) / 100, 0, 1);
        const outcome = actualResult ? 1 : 0;
        return Math.pow(p - outcome, 2);
    }

    calculateBrierAnalytics(bets = []) {
        if (!Array.isArray(bets) || bets.length === 0) {
            return { sampleSize: 0, avgBrier: 0, brierSkillScore: 0, baselineBrier: 0, quality: "NO_DATA" };
        }

        const scores = [];
        const outcomes = [];

        for (const bet of bets) {
            if (!this.isSettledBet(bet)) continue;
            if (this.isPushOrVoid(bet)) continue;

            const prob = this.extractProbability(bet);
            if (prob === null) continue;

            const isWin = this.isWinningBet(bet);
            const outcome = isWin ? 1 : 0;

            outcomes.push(outcome);
            scores.push(this.calculateBrierScore(prob, isWin));
        }

        if (scores.length === 0) {
            return { sampleSize: 0, avgBrier: 0, brierSkillScore: 0, baselineBrier: 0, quality: "NO_DATA" };
        }

        const avgBrier = this.average(scores);

        const baseRate = this.average(outcomes);
        const baselineScores = outcomes.map(o => Math.pow(baseRate - o, 2));
        const baselineBrier = this.average(baselineScores);

        const brierSkillScore = baselineBrier > 0 ? 1 - (avgBrier / baselineBrier) : 0;

        return {
            sampleSize: scores.length,
            avgBrier: Number(avgBrier.toFixed(4)),
            baselineBrier: Number(baselineBrier.toFixed(4)),
            brierSkillScore: Number(brierSkillScore.toFixed(4)),
            quality: this.getBrierQuality(avgBrier)
        };
    }

    // =========================================================================
    // CLV ANALYTICS
    // =========================================================================

    calculateCLV(openOdd, closingOdd) {
        if (!openOdd || !closingOdd) return 0;
        return (((openOdd / closingOdd) - 1) * 100);
    }

    hasVerifiedClvEvidence(bet = {}) {
        // STEP112_CLV_STRUCTURAL_EVIDENCE_COMPAT
        // Questa funzione è usata solo nelle analytics CLV/portfolio, non nel gate pre-match.
        // Un valore CLV percentuale già calcolato o una closing odd reale sono evidenza strutturale
        // sufficiente per il report; clv=0 resta invece N/A e non viene contato.
        const trueFlag = (value) => {
            const text = String(value ?? '').trim().toUpperCase();
            return text === '1' || text === 'TRUE' || text === 'YES' || text === 'Y' || text === 'VERIFIED';
        };
        const num = (value) => {
            if (value === null || value === undefined || value === '') return NaN;
            const n = Number(value);
            return Number.isFinite(n) ? n : NaN;
        };
        const closingOdd = num(bet.closing_odd ?? bet.closingOdd ?? bet.closingLineOdd);
        const legacyClosingOdd = num(bet.clv);
        const directPct = num(bet.clv_pct ?? bet.clvPct);
        const edgePct = num(bet.clv_edge ?? bet.clvEdge);
        const evidenceText = [bet.clv_method, bet.clv_source, bet.clvQualitySource, bet.clv_quality_source, bet.clv_last_attempt_result, bet.settlement_source]
            .map(v => String(v ?? '').toUpperCase())
            .join(' ');
        const sourceHasClosing = evidenceText.includes('POST_MATCH')
            || evidenceText.includes('CLOSING')
            || evidenceText.includes('CLOSE')
            || evidenceText.includes('VAULT')
            || evidenceText.includes('LIVE_API')
            || evidenceText.includes('INTERNAL_VAULT');
        const explicitEvidence = trueFlag(bet.clv_verified ?? bet.clvVerified ?? bet.clv_validated)
            || trueFlag(bet.closing_line_available ?? bet.closingLineAvailable)
            || sourceHasClosing;
        const hasDirectPctEvidence = (Number.isFinite(directPct) && directPct !== 0) || (Number.isFinite(edgePct) && edgePct !== 0);
        const hasClosingOddEvidence = (Number.isFinite(closingOdd) && closingOdd > 1) || (Number.isFinite(legacyClosingOdd) && legacyClosingOdd > 1);
        return explicitEvidence || hasClosingOddEvidence || hasDirectPctEvidence;
    }

    extractClvPct(bet = {}) {
        // STEP91M_VERIFIED_CLV_PORTFOLIO_REPAIR
        if (!this.hasVerifiedClvEvidence(bet)) return null;

        const directPct = this.safeNumber(bet.clv_pct, null);
        if (directPct !== null && Number.isFinite(directPct)) return directPct;

        const edgePct = this.safeNumber(bet.clv_edge, null);
        if (edgePct !== null && Number.isFinite(edgePct)) return edgePct;

        const openOdd = this.safeNumber(bet.odd || bet.open_odd || bet.opening_odd, null);
        const closingOdd = this.safeNumber(bet.closing_odd, null);
        if (openOdd !== null && closingOdd !== null && openOdd > 1 && closingOdd > 1) {
            return this.calculateCLV(openOdd, closingOdd);
        }

        const legacyClosingOdd = this.safeNumber(bet.clv, null);
        if (openOdd !== null && legacyClosingOdd !== null && openOdd > 1 && legacyClosingOdd > 1) {
            return this.calculateCLV(openOdd, legacyClosingOdd);
        }

        return null;
    }



    calculateCLVAnalytics(bets = []) {
        const clvValues = [];

        for (const bet of bets) {
            const clvPct = this.extractClvPct(bet);
            if (clvPct === null || !Number.isFinite(clvPct)) continue;
            clvValues.push(clvPct);
        }

        if (clvValues.length === 0) return { sampleSize: 0, avgCLV: 0, positiveRate: 0, volatility: 0, marketPerformance: "NONE", verified: false };

        const avgCLV = this.average(clvValues);
        const positiveRate = clvValues.filter(v => v > 0).length / clvValues.length;
        let marketPerformance = "NEGATIVE";

        if (avgCLV >= 2.5) marketPerformance = "ELITE";
        else if (avgCLV >= 1.0) marketPerformance = "GOOD";
        else if (avgCLV >= 0.25) marketPerformance = "SLIGHTLY POSITIVE";

        return {
            sampleSize: clvValues.length,
            avgCLV: Number(avgCLV.toFixed(2)),
            positiveRate: Number((positiveRate * 100).toFixed(2)),
            volatility: Number(this.stdDev(clvValues).toFixed(2)),
            marketPerformance,
            verified: clvValues.length > 0
        };
    }

    // =========================================================================
    // ROI & YIELD ANALYTICS
    // =========================================================================

    calculateBetROI(stake, profit) {
        stake = this.safeNumber(stake, null);
        profit = this.safeNumber(profit, null);
        if (stake === null || stake <= 0 || profit === null) return 0;
        const roi = (profit / stake) * 100;
        return Number.isFinite(roi) ? roi : 0;
    }

    calculatePortfolioROI(bets = []) {
        if (!Array.isArray(bets)) throw new TypeError('AUDIT04: bets must be an array');
        let totalStake = 0, totalProfit = 0;
        const roiSeries = [];
        const excluded = { invalidRow: 0, unsettledOrUnknown: 0, invalidMoney: 0, nonPositiveStake: 0 };
        for (const bet of bets) {
            if (!bet || typeof bet !== 'object' || Array.isArray(bet)) { excluded.invalidRow++; continue; }
            if (!this.isSettledBet(bet)) { excluded.unsettledOrUnknown++; continue; }
            const stake = this.safeNumber(bet.stake, null);
            const profit = this.safeNumber(bet.profit, null);
            if (stake === null || profit === null) { excluded.invalidMoney++; continue; }
            if (stake <= 0) { excluded.nonPositiveStake++; continue; }
            const rowROI = (profit / stake) * 100;
            // Abort rather than publish a plausible partial result on arithmetic overflow.
            if (![rowROI, totalStake + stake, totalProfit + profit].every(Number.isFinite))
                throw new RangeError('AUDIT04_ROI_OVERFLOW');
            totalStake += stake; totalProfit += profit; roiSeries.push(rowROI);
        }
        const sampleSize = roiSeries.length;
        const roi = totalStake > 0 ? (totalProfit / totalStake) * 100 : 0;
        const avgProfitPerBet = sampleSize ? totalProfit / sampleSize : 0;
        const volatility = this.stdDev(roiSeries);
        const sharpeLike = sampleSize > 1 ? this.average(roiSeries) / Math.max(volatility, 0.01) : 0;
        if (![roi, avgProfitPerBet, volatility, sharpeLike].every(Number.isFinite))
            throw new RangeError('AUDIT04_ROI_OVERFLOW');
        const rounded = n => Number(n.toFixed(2));
        return {
            totalStake: rounded(totalStake), totalProfit: rounded(totalProfit),
            roi: rounded(roi), yield: rounded(roi), avgProfitPerBet: rounded(avgProfitPerBet),
            volatility: rounded(volatility), sharpeLike: rounded(sharpeLike),
            sampleSize, excludedRows: bets.length - sampleSize, excluded,
            hasData: sampleSize > 0,
            roiPolicy: 'AUDIT04_SETTLED_POSITIVE_STAKE_FINITE_MONEY_INCLUDES_PUSH_VOID'
        };
    }

    // =========================================================================
    // STRATEGY ANALYTICS
    // =========================================================================

    calculateStrategyAnalytics(bets = []) {
        const grouped = {};

        for (const bet of bets) {
            let strategy = bet.strategy_tag || bet.strategy || bet.market_type || '';
            
            if (!strategy || strategy === 'UNKNOWN') {
                const isTennis = String(bet.bet_type).includes('TENNIS');
                const pred = String(bet.prediction).toUpperCase();
                if (isTennis) strategy = pred.includes('OVER') || pred.includes('UNDER') ? 'TENNIS_TOTALS' : 'TENNIS_MATCH';
                else strategy = pred.includes('O') || pred.includes('U') ? 'CALCIO_TOTALS' : 'CALCIO_1X2';
            }

            if (!grouped[strategy]) grouped[strategy] = [];
            grouped[strategy].push(bet);
        }

        const report = [];

        for (const strategyName of Object.keys(grouped)) {
            const strategyBets = grouped[strategyName];
            const closedBets = strategyBets.filter(b => this.isSettledBet(b));
            if (closedBets.length === 0) continue;

            const roi = this.calculatePortfolioROI(closedBets);
            const brier = this.calculateBrierAnalytics(closedBets);
            const clv = this.calculateCLVAnalytics(closedBets);
            const decisiveBets = closedBets.filter(b => !this.isPushOrVoid(b));
            const wins = decisiveBets.filter(b => this.isWinningBet(b)).length;
            const hitRate = decisiveBets.length ? (wins / decisiveBets.length) * 100 : 0;

            report.push({
                strategy: strategyName,
                bets: closedBets.length,
                hitRateSampleSize: decisiveBets.length,
                roiSampleSize: roi.sampleSize,
                roiExcludedRows: roi.excludedRows,
                hitRate: Number(hitRate.toFixed(2)),
                roi: roi.roi,
                totalProfit: roi.totalProfit,
                avgCLV: clv.avgCLV,
                positiveCLVRate: clv.positiveRate,
                brier: brier.avgBrier,
                sharpeLike: roi.sharpeLike,
                quality: this.classifyStrategyQuality(roi.roi, clv.avgCLV, brier.avgBrier)
            });
        }

        return report.sort((a, b) => b.roi - a.roi);
    }

    classifyStrategyQuality(roi, clv, brier) {
        if (roi >= 8 && clv >= 1.5 && brier <= 0.19) return "ELITE";
        if (roi >= 4 && clv >= 0.75 && brier <= 0.23) return "GOOD";
        if (roi >= 0 && clv >= 0) return "NEUTRAL";
        return "NEGATIVE";
    }

    // =========================================================================
    // CALIBRATION BUCKETS ENGINE
    // =========================================================================

    getProbabilityBucket(probabilityPct, bucketSize = 5) {
        const p = this.clamp(
            this.safeNumber(probabilityPct, 0),
            0,
            100
        );

        let lower = Math.floor(p / bucketSize) * bucketSize;
        let upper = lower + bucketSize;

        if (upper > 100) {
            upper = 100;
            lower = Math.max(0, 100 - bucketSize);
        }

        return `${lower}-${upper}`;
    }

    calculateCalibrationBuckets(bets = [], options = {}) {
        const {
            bucketSize = 5,
            minSample = 10,
            sportFilter = null,
            strategyFilter = null
        } = options;

        if (!Array.isArray(bets) || bets.length === 0) {
            return {
                sampleSize: 0,
                bucketSize,
                buckets: [],
                summary: {
                    avgCalibrationError: 0,
                    weightedCalibrationError: 0,
                    maxBucketError: 0,
                    overconfidenceIndex: 0,
                    underconfidenceIndex: 0,
                    expectedCalibrationError: 0,
                    quality: "NO_DATA"
                }
            };
        }

        const grouped = {};

        for (const bet of bets) {
            if (!this.isSettledBet(bet)) continue;
            if (this.isPushOrVoid(bet)) continue;

            if (sportFilter) {
                const normalizedSport = this.normalizeSportType(bet);
                const requestedSport = String(sportFilter).toLowerCase();

                const sportMatch =
                    normalizedSport === requestedSport ||
                    (requestedSport === 'calcio' && normalizedSport === 'football') ||
                    (requestedSport === 'football' && normalizedSport === 'football') ||
                    (requestedSport === 'tennis' && normalizedSport === 'tennis');

                if (!sportMatch) continue;
            }

            if (strategyFilter) {
                const strategyRaw = String(
                    bet.strategy_tag ||
                    bet.strategy ||
                    bet.market_type ||
                    ''
                ).toUpperCase();

                if (!strategyRaw.includes(String(strategyFilter).toUpperCase())) {
                    continue;
                }
            }

            const probability = this.extractProbability(bet);
            if (probability === null) continue;

            const bucket = this.getProbabilityBucket(probability, bucketSize);

            if (!grouped[bucket]) {
                grouped[bucket] = {
                    bucket,
                    lower: parseInt(bucket.split('-')[0], 10),
                    upper: parseInt(bucket.split('-')[1], 10),
                    bets: [],
                    wins: 0,
                    losses: 0,
                    probabilities: [],
                    brierScores: []
                };
            }

            const isWin = this.isWinningBet(bet);

            grouped[bucket].bets.push(bet);
            grouped[bucket].probabilities.push(probability);
            grouped[bucket].brierScores.push(
                this.calculateBrierScore(probability, isWin)
            );

            if (isWin) grouped[bucket].wins++;
            else grouped[bucket].losses++;
        }

        const buckets = [];
        let totalBets = 0;
        let weightedErrorSum = 0;
        let absoluteErrorSum = 0;
        let validBucketCount = 0;
        let overconfidenceWeighted = 0;
        let underconfidenceWeighted = 0;
        let maxBucketError = 0;

        for (const bucketName of Object.keys(grouped)) {
            const b = grouped[bucketName];
            const sample = b.bets.length;

            const avgPredictedProb = this.average(b.probabilities, 0);
            const observedWinRate = sample > 0 ? (b.wins / sample) * 100 : 0;
            const calibrationError = avgPredictedProb - observedWinRate;
            const absCalibrationError = Math.abs(calibrationError);
            const avgBrier = this.average(b.brierScores, 0);

            const z = 1.96;
            const n = sample;
            const phat = n > 0 ? b.wins / n : 0;
            const denominator = 1 + ((z * z) / n);
            const centre = phat + ((z * z) / (2 * n));
            const margin = z * Math.sqrt(((phat * (1 - phat)) + ((z * z) / (4 * n))) / n);

            const wilsonLow = n > 0 ? ((centre - margin) / denominator) * 100 : 0;
            const wilsonHigh = n > 0 ? ((centre + margin) / denominator) * 100 : 0;

            let status = "LOW_SAMPLE";

            if (sample >= minSample) {
                status = "CALIBRATED";

                if (calibrationError >= 10) {
                    status = "OVERCONFIDENT_CRITICAL";
                }
                else if (calibrationError >= 7) {
                    status = "OVERCONFIDENT";
                }
                else if (calibrationError <= -10) {
                    status = "UNDERCONFIDENT_CRITICAL";
                }
                else if (calibrationError <= -7) {
                    status = "UNDERCONFIDENT";
                }
                else if (absCalibrationError >= 5) {
                    status = "SLIGHTLY_MISCALIBRATED";
                }

                totalBets += sample;
                weightedErrorSum += absCalibrationError * sample;
                absoluteErrorSum += absCalibrationError;
                validBucketCount++;
                maxBucketError = Math.max(maxBucketError, absCalibrationError);

                if (calibrationError > 0) {
                    overconfidenceWeighted += calibrationError * sample;
                }
                else {
                    underconfidenceWeighted += Math.abs(calibrationError) * sample;
                }
            }

            buckets.push({
                bucket: b.bucket,
                lower: b.lower,
                upper: b.upper,
                sample,
                minSample,
                sampleReliable: sample >= minSample,
                wins: b.wins,
                losses: b.losses,
                avgPredictedProb: Number(avgPredictedProb.toFixed(2)),
                observedWinRate: Number(observedWinRate.toFixed(2)),
                calibrationError: Number(calibrationError.toFixed(2)),
                absCalibrationError: Number(absCalibrationError.toFixed(2)),
                avgBrier: Number(avgBrier.toFixed(4)),
                wilsonLow: Number(wilsonLow.toFixed(2)),
                wilsonHigh: Number(wilsonHigh.toFixed(2)),
                suggestedProbabilityAdjustment: sample >= minSample ? Number((-calibrationError).toFixed(2)) : 0,
                status
            });
        }

        buckets.sort((a, b) => a.lower - b.lower);

        const avgCalibrationError = validBucketCount > 0 ? absoluteErrorSum / validBucketCount : 0;
        const weightedCalibrationError = totalBets > 0 ? weightedErrorSum / totalBets : 0;
        const overconfidenceIndex = totalBets > 0 ? overconfidenceWeighted / totalBets : 0;
        const underconfidenceIndex = totalBets > 0 ? underconfidenceWeighted / totalBets : 0;
        const expectedCalibrationError = weightedCalibrationError;

        const quality = validBucketCount > 0 ? this.getCalibrationQuality(weightedCalibrationError, maxBucketError) : 'LOW_SAMPLE';

        return {
            sampleSize: totalBets,
            rawBucketCount: Object.keys(grouped).length,
            validBucketCount,
            bucketSize,
            minSample,
            buckets,
            summary: {
                avgCalibrationError: Number(avgCalibrationError.toFixed(2)),
                weightedCalibrationError: Number(weightedCalibrationError.toFixed(2)),
                maxBucketError: Number(maxBucketError.toFixed(2)),
                overconfidenceIndex: Number(overconfidenceIndex.toFixed(2)),
                underconfidenceIndex: Number(underconfidenceIndex.toFixed(2)),
                expectedCalibrationError: Number(expectedCalibrationError.toFixed(2)),
                quality
            }
        };
    }

    // =========================================================================
    // PROBABILITY CALIBRATION APPLICATION (FEEDBACK LOOP)
    // =========================================================================

    findCalibrationBucket(probabilityPct, calibrationReport) {
        if (!calibrationReport || !Array.isArray(calibrationReport.buckets)) return null;
        const p = this.clamp(this.safeNumber(probabilityPct, 50), 1, 99);
        return calibrationReport.buckets.find(bucket => p >= bucket.lower && p < bucket.upper) || null;
    }

    calibrateProbabilityByBuckets(probabilityPct, calibrationReport, options = {}) {
        const { maxAdjustment = 8, minReliableSample = 20, shrinkToMarket = null } = options;

        const originalProbability = this.clamp(this.safeNumber(probabilityPct, 50), 1, 99);
        const bucket = this.findCalibrationBucket(originalProbability, calibrationReport);

        if (!bucket || bucket.sample < minReliableSample) {
            return {
                probability: Number(originalProbability.toFixed(2)),
                originalProbability: Number(originalProbability.toFixed(2)),
                adjustment: 0,
                bucket: bucket ? bucket.bucket : null,
                reliability: "NO_RELIABLE_BUCKET",
                reason: "Bucket assente o campione insufficiente"
            };
        }

        let adjustment = this.safeNumber(bucket.suggestedProbabilityAdjustment, 0);
        adjustment = this.clamp(adjustment, -maxAdjustment, maxAdjustment);

        let calibratedProbability = originalProbability + adjustment;

        if (shrinkToMarket !== null && !isNaN(shrinkToMarket)) {
            const marketProb = this.clamp(this.safeNumber(shrinkToMarket, originalProbability), 1, 99);
            const bucketIsWeak = bucket.status.includes('OVERCONFIDENT') || bucket.status.includes('UNDERCONFIDENT') || bucket.status === 'SLIGHTLY_MISCALIBRATED';

            if (bucketIsWeak) {
                calibratedProbability = (calibratedProbability * 0.70) + (marketProb * 0.30);
            }
        }

        calibratedProbability = this.clamp(calibratedProbability, 1, 99);

        return {
            probability: Number(calibratedProbability.toFixed(2)),
            originalProbability: Number(originalProbability.toFixed(2)),
            adjustment: Number((calibratedProbability - originalProbability).toFixed(2)),
            bucket: bucket.bucket,
            bucketStatus: bucket.status,
            bucketSample: bucket.sample,
            bucketObservedWinRate: bucket.observedWinRate,
            bucketPredictedProb: bucket.avgPredictedProb,
            reliability: bucket.status === 'CALIBRATED' ? "RELIABLE" : "ADJUSTED",
            reason: bucket.status === 'CALIBRATED' ? "Bucket calibrato" : "Probabilità corretta usando storico bucket"
        };
    }

    buildReliabilityReport(bets = [], options = {}) {
        const brier = this.calculateBrierAnalytics(bets);
        const calibration = this.calculateCalibrationBuckets(bets, options);
        const clv = this.calculateCLVAnalytics(bets);
        const roi = this.calculatePortfolioROI(bets);

        const decision = this.getReliabilityDecision({
            brier: brier.avgBrier,
            calibrationError: calibration.summary.weightedCalibrationError,
            sampleSize: calibration.sampleSize,
            clv: clv.avgCLV
        });

        return {
            sampleSize: calibration.sampleSize,
            roi,
            clv,
            brier,
            calibration,
            decision
        };
    }

    // =========================================================================
    // SPORT & STRATEGY REPORTS
    // =========================================================================

    calculateSportAnalytics(bets = []) {
        const sports = { football: [], tennis: [], unknown: [] };

        for (const bet of bets) {
            const normalizedSport = this.normalizeSportType(bet);

            if (normalizedSport === 'football') sports.football.push(bet);
            else if (normalizedSport === 'tennis') sports.tennis.push(bet);
            else sports.unknown.push(bet);
        }

        const footballReport = this.buildReliabilityReport(sports.football, { bucketSize: 5, minSample: 10 });
        const tennisReport = this.buildReliabilityReport(sports.tennis, { bucketSize: 5, minSample: 10 });

        return {
            football: {
                ...footballReport,
                sample: sports.football.length
            },
            tennis: {
                ...tennisReport,
                sample: sports.tennis.length
            },
            unknown: {
                sample: sports.unknown.length,
                warning: sports.unknown.length > 0 ? "Esistono bet senza sport_type affidabile." : null
            }
        };
    }

    calculateSportCalibrationReport(bets = [], options = {}) {
        return {
            football: this.calculateCalibrationBuckets(bets, { bucketSize: 5, minSample: 10, ...options, sportFilter: 'football' }),
            tennis: this.calculateCalibrationBuckets(bets, { bucketSize: 5, minSample: 10, ...options, sportFilter: 'tennis' })
        };
    }

    calculateStrategyCalibrationReport(bets = [], options = {}) {
        const strategies = {};

        for (const bet of bets) {
            const strategy = bet.strategy_tag || bet.strategy || bet.market_type || 'UNKNOWN';
            if (!strategies[strategy]) strategies[strategy] = [];
            strategies[strategy].push(bet);
        }

        const report = [];

        for (const strategyName of Object.keys(strategies)) {
            const calibration = this.calculateCalibrationBuckets(strategies[strategyName], options);
            report.push({ strategy: strategyName, sampleSize: calibration.sampleSize, summary: calibration.summary, buckets: calibration.buckets });
        }

        return report.sort((a, b) => b.sampleSize - a.sampleSize);
    }

    // =========================================================================
    // MARKET VALIDATION & FALLBACK
    // =========================================================================

    validateMarketEdge(modelProb, marketProb) {
        const edge = this.safeNumber(modelProb, 0) - this.safeNumber(marketProb, 0);
        let validation = "NO EDGE";

        if (edge >= 10) validation = "EXTREME VALUE";
        else if (edge >= 6) validation = "STRONG VALUE";
        else if (edge >= 3) validation = "VALUE";
        else if (edge >= 1) validation = "SMALL VALUE";

        return { edge: Number(edge.toFixed(2)), validation };
    }

    calibrateConfidence(probability, brierScore, calibrationError = 0) {
        probability = this.safeNumber(probability, 50);
        brierScore = this.safeNumber(brierScore, 0.25);
        calibrationError = Math.abs(this.safeNumber(calibrationError, 0));

        let adjustment = 1.0;

        if (brierScore <= 0.19 && calibrationError <= 5) adjustment = 1.04;
        else if (brierScore <= 0.22 && calibrationError <= 7.5) adjustment = 1.00;
        else if (brierScore <= 0.245 || calibrationError <= 10) adjustment = 0.94;
        else if (brierScore <= 0.27 || calibrationError <= 13) adjustment = 0.88;
        else adjustment = 0.80;

        const centered = probability - 50;
        const calibrated = 50 + (centered * adjustment);

        return this.clamp(calibrated, 1, 99);
    }
}

module.exports = new ValueEvaluator();