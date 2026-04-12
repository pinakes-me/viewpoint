import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function getReviewsByBookIds(
  bookIds: number[]
): Promise<Record<number, string[]>> {
  const { data, error } = await supabase
    .from("reviews")
    .select("book_id, headline, source, stance")
    .in("book_id", bookIds);

  if (error || !data) return {};

  const map: Record<number, string[]> = {};
  data.forEach((r: any) => {
    if (!map[r.book_id]) map[r.book_id] = [];
    map[r.book_id].push(`[${r.source}] ${r.headline}`);
  });
  return map;
}
