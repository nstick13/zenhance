"use client";

import { useEffect, useMemo, useState } from "react";
import { Circle, Ellipse, Group, Image as KonvaImage } from "react-konva";
import type { PlacedSeat } from "@/lib/map/layout/layout";
import { avatarPalette } from "@/lib/map/runtime/avatar";


/** A photo when available; otherwise a clearly illustrative face placeholder.
 * Names stay in hover/tap detail so even the smallest people remain legible. */
export function SeatAvatar({ seat, stroke }: { seat: PlacedSeat; stroke: string }) {
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const source = seat.photoUrl;
  useEffect(() => {
    setPhoto(null);
    if (!source || !/^(https?:\/\/|data:image\/)/i.test(source)) return;
    let live = true;
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { if (live) setPhoto(image); };
    image.onerror = () => { if (live) setPhoto(null); };
    image.src = source;
    return () => { live = false; };
  }, [source]);

  const palette = useMemo(() => {
    return avatarPalette(seat.personId ?? seat.id);
  }, [seat.personId, seat.id]);
  const size = seat.r * 2;
  const aspect = photo ? Math.max(size / photo.naturalWidth, size / photo.naturalHeight) : 1;
  const photoWidth = photo ? photo.naturalWidth * aspect : size;
  const photoHeight = photo ? photo.naturalHeight * aspect : size;

  return (
    <Group listening={false}>
      <Group clipFunc={(ctx) => { ctx.beginPath(); ctx.arc(0, 0, seat.r, 0, Math.PI * 2); }} listening={false}>
        <Circle radius={seat.r} fill={palette.background} listening={false} />
        {photo ? (
          <KonvaImage
            image={photo}
            x={-photoWidth / 2}
            y={-photoHeight / 2}
            width={photoWidth}
            height={photoHeight}
            listening={false}
          />
        ) : (
          <Group scaleX={seat.r / 9.5} scaleY={seat.r / 9.5} listening={false}>
            <Ellipse x={0} y={7} radiusX={8} radiusY={5.5} fill={palette.shirt} listening={false} />
            <Circle x={0} y={-2.3} radius={4.7} fill={palette.hair} listening={false} />
            <Ellipse x={0} y={-1} radiusX={3.8} radiusY={4.4} fill={palette.skin} listening={false} />
            <Ellipse x={0} y={-5} radiusX={4} radiusY={2.1} fill={palette.hair} listening={false} />
          </Group>
        )}
      </Group>
      <Circle radius={seat.r} stroke={stroke} strokeWidth={seat.kind === "lead" ? 2 : 1.35} listening={false} />
    </Group>
  );
}
