import crypto from "crypto";

export const CLICK_ERRORS = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_NOT_FOUND: -5,
  TRANSACTION_NOT_FOUND: -6,
  UPDATE_FAILED: -7,
  ERROR_IN_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
} as const;

const MERCHANT_ID = () => process.env.CLICK_MERCHANT_ID!;
const SERVICE_ID = () => process.env.CLICK_SERVICE_ID!;
const SECRET_KEY = () => process.env.CLICK_SECRET_KEY!;

/**
 * Verify MD5 signature for Click Prepare request
 * sign_string = md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time)
 */
export function verifyPrepareSign(params: {
  click_trans_id: string;
  merchant_trans_id: string;
  amount: string;
  action: string;
  sign_time: string;
  sign_string: string;
}): boolean {
  const data =
    params.click_trans_id +
    SERVICE_ID() +
    SECRET_KEY() +
    params.merchant_trans_id +
    params.amount +
    params.action +
    params.sign_time;
  const hash = crypto.createHash("md5").update(data).digest("hex");
  return hash === params.sign_string;
}

/**
 * Verify MD5 signature for Click Complete request
 * sign_string = md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id + amount + action + sign_time)
 */
export function verifyCompleteSign(params: {
  click_trans_id: string;
  merchant_trans_id: string;
  merchant_prepare_id: string;
  amount: string;
  action: string;
  sign_time: string;
  sign_string: string;
}): boolean {
  const data =
    params.click_trans_id +
    SERVICE_ID() +
    SECRET_KEY() +
    params.merchant_trans_id +
    params.merchant_prepare_id +
    params.amount +
    params.action +
    params.sign_time;
  const hash = crypto.createHash("md5").update(data).digest("hex");
  return hash === params.sign_string;
}

/**
 * Build Click payment redirect URL
 */
export function buildClickPayUrl(params: {
  orderId: string;
  amount: number;
  returnUrl: string;
}): string {
  const url = new URL("https://my.click.uz/services/pay");
  url.searchParams.set("service_id", SERVICE_ID());
  url.searchParams.set("merchant_id", MERCHANT_ID());
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("transaction_param", params.orderId);
  url.searchParams.set("return_url", params.returnUrl);
  return url.toString();
}
