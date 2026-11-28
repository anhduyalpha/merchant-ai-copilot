import { POST as settleDebtPost } from './settle/route';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return settleDebtPost(request, context);
}
