// v1/lib/ui/common/AutoResizeTextarea.tsx
"use client";

import React, { useEffect, useRef } from "react";

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export default function AutoResizeTextarea({ style, onInput, value, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = () => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  };

  useEffect(() => {
    resize();
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
      style={{ resize: "none", overflow: "hidden", ...style }}
      {...rest}
    />
  );
}
