import { NextResponse } from "next/server";
import { instanceState } from "../../../../lib/server-config";

export async function GET() {
  const state = await instanceState();
  return NextResponse.json({
    isFirstUser: !state.hasAnyUser,
    allowPublicSignup: state.allowPublicSignup,
  });
}
