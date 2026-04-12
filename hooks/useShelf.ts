"use client";

import { useCallback, useEffect, useState } from "react";
import { ShelfItem } from "@/lib/types";
import * as shelfLib from "@/lib/shelf";

const SHELF_EVENT = "viewpoint:shelf-updated";

export function useShelf() {
  const [items, setItems] = useState<ShelfItem[]>([]);

  const refresh = useCallback(() => {
    setItems(shelfLib.getShelf());
  }, []);

  useEffect(() => {
    refresh();
    // fires in OTHER tabs
    window.addEventListener("storage", refresh);
    // fires in SAME tab (custom event)
    window.addEventListener(SHELF_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SHELF_EVENT, refresh);
    };
  }, [refresh]);

  const dispatch = useCallback(() => {
    window.dispatchEvent(new Event(SHELF_EVENT));
  }, []);

  const addToShelf = useCallback(
    (item: Omit<ShelfItem, "id" | "savedAt">) => {
      shelfLib.addToShelf(item);
      dispatch(); // force immediate re-render in same tab
    },
    [dispatch]
  );

  const removeFromShelf = useCallback(
    (id: string) => {
      shelfLib.removeFromShelf(id);
      dispatch();
    },
    [dispatch]
  );

  const clearShelf = useCallback(() => {
    shelfLib.clearShelf();
    dispatch();
  }, [dispatch]);

  const isInShelf = useCallback(
    (title: string, author: string) => {
      return shelfLib.isInShelf(title, author);
    },
    [items] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    shelf: items,
    addToShelf,
    removeFromShelf,
    clearShelf,
    isInShelf,
  };
}
