// Work that should happen right after an API response, without making
// the person wait for it (e.g. the confirmation emails after a booking).
//
// On Vercel, waitUntil keeps the function running after the response
// is sent until `promise` settles. Anywhere else (local dev, tests) it's
// simply awaited before responding, so the result is identical — just
// not detached.
import { waitUntil } from "@vercel/functions";

export async function afterResponse(promise) {
  if (process.env.VERCEL) {
    waitUntil(promise);
    return;
  }
  await promise;
}
