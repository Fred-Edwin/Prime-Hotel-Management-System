import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AssetsClient } from "./AssetsClient";

export default async function AssetsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: assets } = await supabase.from("assets").select("*").order("name");
  const { data: onHand } = await supabase.rpc("dashboard_assets_on_hand");

  const onHandByAsset = new Map((onHand ?? []).map((row) => [row.asset_id, row]));
  const assetsWithOnHand = (assets ?? []).map((asset) => ({
    ...asset,
    quantity_on_hand: onHandByAsset.get(asset.id)?.quantity_on_hand ?? 0,
    value: onHandByAsset.get(asset.id)?.value ?? 0,
  }));

  return <AssetsClient initialAssets={assetsWithOnHand} />;
}
