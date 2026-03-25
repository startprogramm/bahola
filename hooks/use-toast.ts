"use client";

import { useCallback } from "react";

export function useToast() {
  const toast = useCallback((props: any) => {
    console.log("Toast suppressed:", props.title);
  }, []);

  return {
    toast,
    dismiss: () => {},
    toasts: [],
  };
}
