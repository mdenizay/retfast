import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MapView from "@/components/MapView";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n";
import { ZONE_COLORS } from "@/lib/map/provider";
import { supabase } from "@/lib/supabase";
import type { GeoZone, ZoneType } from "@/lib/types";
import { Trash2 } from "lucide-react";

const ZONE_TYPES: ZoneType[] = ["takeoff", "landing", "restricted", "checkpoint", "custom"];

export default function ZonesTab({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const { m } = useI18n();
  const { session } = useAuth();
  const [zones, setZones] = useState<GeoZone[]>([]);
  const [pending, setPending] = useState<GeoJSON.Geometry | null>(null);
  const [name, setName] = useState("");
  const [zoneType, setZoneType] = useState<ZoneType>("custom");
  const drawRef = useRef<TerraDraw | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("geo_zones")
      .select("*")
      .eq("event_id", eventId)
      .order("sort_order")
      .order("created_at");
    setZones((data as GeoZone[]) ?? []);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onMapReady = useCallback(
    (map: MLMap) => {
      if (!canEdit) return;
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode(), new TerraDrawPointMode(), new TerraDrawLineStringMode()],
      });
      draw.start();
      draw.on("finish", (id) => {
        const feature = draw.getSnapshot().find((f) => f.id === id);
        if (feature) setPending(feature.geometry as GeoJSON.Geometry);
      });
      drawRef.current = draw;
    },
    [canEdit],
  );

  useEffect(() => () => drawRef.current?.stop(), []);

  async function saveZone() {
    if (!pending) return;
    const { error } = await supabase.from("geo_zones").insert({
      event_id: eventId,
      name,
      zone_type: zoneType,
      geometry: pending,
      created_by: session!.user.id,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(m.zones.saved);
      setPending(null);
      setName("");
      drawRef.current?.clear();
      void load();
    }
  }

  async function deleteZone(zone: GeoZone) {
    const { error } = await supabase.from("geo_zones").delete().eq("id", zone.id);
    if (error) toast.error(error.message);
    else {
      toast.success(m.zones.deleted);
      void load();
    }
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{m.zones.draw}:</span>
          <Button size="sm" variant="outline" onClick={() => drawRef.current?.setMode("polygon")}>
            {m.zones.polygon}
          </Button>
          <Button size="sm" variant="outline" onClick={() => drawRef.current?.setMode("point")}>
            {m.zones.point}
          </Button>
          <Button size="sm" variant="outline" onClick={() => drawRef.current?.setMode("linestring")}>
            {m.zones.linestring}
          </Button>
        </div>
      )}
      <MapView className="h-[480px] w-full rounded-md border" zones={zones} onReady={onMapReady} />
      {zones.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.zones.empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {zones.map((z) => (
            <Badge
              key={z.id}
              variant="outline"
              className="gap-2 py-1"
              style={{ borderColor: ZONE_COLORS[z.zone_type] }}
            >
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: ZONE_COLORS[z.zone_type] }}
              />
              {z.name} · {m.zones.types[z.zone_type]}
              {canEdit && (
                <button type="button" title={m.common.delete} onClick={() => deleteZone(z)}>
                  <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.zones.save}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{m.zones.name}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <Label>{m.zones.type}</Label>
              <Select value={zoneType} onValueChange={(v) => setZoneType(v as ZoneType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ZONE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {m.zones.types[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={saveZone} disabled={!name} className="w-full">
              {m.common.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
