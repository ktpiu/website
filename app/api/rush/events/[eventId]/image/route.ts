import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getEvent } from "@/lib/rush/events";
import { removeRushObject, RushError, rushErrorResponse, uploadRushImage } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { eventId } = await params;
    const event = await getEvent(eventId);
    const image = (await request.formData().catch(() => null))?.get("image");
    if (!(image instanceof File) || image.size === 0) throw new RushError(400, "Choose an image.");

    const path = await uploadRushImage(`events/${event.id}`, image);
    const { error } = await supabaseAdmin.from("rush_events").update({ image_path: path }).eq("id", event.id);
    if (error) {
      await removeRushObject(path);
      throw error;
    }
    await removeRushObject(event.image_path);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to upload the image.");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { eventId } = await params;
    const event = await getEvent(eventId);
    const { error } = await supabaseAdmin.from("rush_events").update({ image_path: null }).eq("id", event.id);
    if (error) throw error;
    await removeRushObject(event.image_path);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to remove the image.");
  }
}
