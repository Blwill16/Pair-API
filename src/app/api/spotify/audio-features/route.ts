import { NextRequest, NextResponse } from "next/server";
import { getAudioFeatures } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ids = searchParams.get("ids");

    if (!ids) {
      return NextResponse.json(
        { error: "Missing query parameter 'ids'" },
        { status: 400 }
      );
    }

    const trackIds = ids.split(",").slice(0, 100);
    const features = await getAudioFeatures(trackIds);

    return NextResponse.json({ audio_features: features });
  } catch (error) {
    console.error("Audio features error:", error);
    return NextResponse.json(
      { error: "Failed to get audio features" },
      { status: 500 }
    );
  }
}
