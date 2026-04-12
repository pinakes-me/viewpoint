import { BookResult } from "@/lib/types";
export type { BookResult };
import { supabase } from "./supabase";

export async function searchBooksByTopic(topic: string): Promise<BookResult[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .ilike("topics", `%${topic}%`)
    .limit(20);

  if (error) {
    console.error("Supabase search error:", error);
    return [];
  }
  return (data as BookResult[]) || [];
}

export async function searchBooksByTitle(keyword: string): Promise<BookResult[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .ilike("title", `%${keyword}%`)
    .limit(20);

  if (error) {
    console.error("Supabase search error:", error);
    return [];
  }
  return (data as BookResult[]) || [];
}
