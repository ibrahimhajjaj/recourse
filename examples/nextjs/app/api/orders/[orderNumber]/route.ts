/**
 * A stand-in for the shop's real order system, so the procedure has something
 * to look up. Order numbers ending in an even digit are wholesale.
 */
export async function GET(_request: Request, context: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await context.params
  const last = Number.parseInt(orderNumber.slice(-1), 10)
  const wholesale = Number.isFinite(last) && last % 2 === 0

  return Response.json({
    orderNumber,
    placedAt: wholesale ? '2026-08-20' : '2026-08-25',
    weightKg: wholesale ? 6 : 0.5,
    wholesale,
    status: 'delivered',
    internalNote: 'this must never reach the customer',
  })
}
