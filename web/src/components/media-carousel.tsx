"use client";

import * as React from "react";
import Link from "next/link";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

interface PostMedia {
  id: number;
  post_id: string;
  media_type: "image" | "video";
  file_path: string;
  thumbnail_path: string | null;
  order: number;
}

interface MediaCarouselProps {
  media: PostMedia[];
  detailUrl?: string;
}

function AutoplayVideo({ src, className }: { src: string; className?: string }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      className={className}
      muted
      loop
      playsInline
    />
  );
}

function MediaItem({
  item,
  detailUrl,
}: {
  item: PostMedia;
  detailUrl?: string;
}) {
  const content =
    item.media_type === "image" ? (
      <img
        src={`/api/media/${item.file_path}`}
        alt=""
        className="w-full"
      />
    ) : (
      <AutoplayVideo
        src={`/api/media/${item.file_path}`}
        className="w-full"
      />
    );

  if (detailUrl) {
    return <Link href={detailUrl}>{content}</Link>;
  }
  return content;
}

export function MediaCarousel({ media, detailUrl }: MediaCarouselProps) {
  const [api, setApi] = React.useState<CarouselApi>();
  const [current, setCurrent] = React.useState(0);
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    if (!api) return;
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap());

    api.on("select", () => {
      setCurrent(api.selectedScrollSnap());
    });
  }, [api]);

  if (media.length === 0) return null;

  // Single media item - no carousel UI
  if (media.length === 1) {
    return <MediaItem item={media[0]} detailUrl={detailUrl} />;
  }

  return (
    <div className="relative">
      <Carousel setApi={setApi} opts={{ loop: true }}>
        <CarouselContent className="ml-0">
          {media.map((item) => (
            <CarouselItem key={item.id} className="pl-0">
              <MediaItem item={item} detailUrl={detailUrl} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious
          className="left-2 bg-black/40 border-0 text-white hover:bg-black/60 disabled:opacity-0"
        />
        <CarouselNext
          className="right-2 bg-black/40 border-0 text-white hover:bg-black/60 disabled:opacity-0"
        />
      </Carousel>
      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5 py-2">
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            className={cn(
              "size-1.5 rounded-full transition-colors",
              i === current ? "bg-foreground" : "bg-foreground/30"
            )}
            onClick={() => api?.scrollTo(i)}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
