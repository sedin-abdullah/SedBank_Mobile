/**
 * Product + underwriting policy access.
 * Everything that could be a "business rule" is read through here so an admin
 * can change pricing or credit policy without a code change or redeploy.
 */
import Config from '../models/Config.js';
import { recordAudit } from './auditService.js';
import { broadcastDataChange } from '../realtime/socket.js';

export const getConfig = () => Config.getSingleton();

/** Plain object copy, safe to hand to pure functions. */
export async function getPolicy() {
  const config = await getConfig();
  return {
    product: config.product.toObject ? config.product.toObject() : config.product,
    underwriting: config.underwriting.toObject
      ? config.underwriting.toObject()
      : config.underwriting,
  };
}

/**
 * The subset of config a customer is allowed to see (drives the eligibility
 * calculator and the amount/tenure sliders). Credit policy stays internal.
 */
export async function getPublicProduct() {
  const config = await getConfig();
  const p = config.product;
  return {
    code: p.code,
    name: p.name,
    minAmount: p.minAmount,
    maxAmount: p.maxAmount,
    minTenureMonths: p.minTenureMonths,
    maxTenureMonths: p.maxTenureMonths,
    minRoi: p.minRoi,
    maxRoi: p.maxRoi,
    processingFeePct: p.processingFeePct,
    latePenaltyPct: p.latePenaltyPct,
    foreclosureChargePct: p.foreclosureChargePct,
    /*
     * The income floor is an eligibility criterion, not credit policy: it is
     * a hard knock-out applied after the bureau pull, so without it the form
     * cannot warn anyone and an applicant earning under it completes KYC and
     * a credit check before being told. Published like the amount limits;
     * the scoring thresholds and the risk grid stay internal.
     */
    minMonthlyIncome: config.underwriting.minMonthlyIncome,
  };
}

/**
 * Prices an approved offer from the bureau score using the configured risk grid.
 * Falls back to the product's ceiling rate if no band matches.
 */
export function roiForScore(score, policy) {
  const grid = [...(policy.underwriting.riskPricing || [])].sort((a, b) => b.minScore - a.minScore);
  const match = grid.find((row) => score >= row.minScore);
  const roi = match?.roi ?? policy.product.maxRoi;
  // Never price outside the product's approved band.
  return Math.min(policy.product.maxRoi, Math.max(policy.product.minRoi, roi));
}

export async function updateConfig({ product = {}, underwriting = {} }, actor, ip) {
  const config = await getConfig();

  if (product && Object.keys(product).length) config.product.set(product);
  if (underwriting && Object.keys(underwriting).length) config.underwriting.set(underwriting);
  config.updatedBy = actor?._id ?? null;

  await config.save();

  await recordAudit({
    entity: 'Config',
    entityId: config._id,
    action: 'config.updated',
    description: 'Product / underwriting configuration updated',
    actor,
    meta: { product, underwriting },
    ip,
  });

  broadcastDataChange(['config']);
  return config;
}

export default { getConfig, getPolicy, getPublicProduct, roiForScore, updateConfig };
