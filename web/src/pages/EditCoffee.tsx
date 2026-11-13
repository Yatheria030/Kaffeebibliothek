import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coffee } from "lucide-react";
import { useEffect, useState } from "react";
import type { CoffeeFields } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { navigate } from "../lib/router.ts";
import { Button, EmptyState, Spinner } from "../ui/controls.tsx";
import { toast } from "../ui/overlay.tsx";
import { BackLink, LargeTitle, Page, Toolbar } from "../ui/Shell.tsx";
import { CoffeeFieldsForm, cleanFields, colorFor, ImagePicker, resolveImage, type ImageChoice } from "./CoffeeForm.tsx";

export function EditCoffee({ id }: { id: number }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["coffee", id], queryFn: () => api.coffee(id) });
  const [fields, setFields] = useState<CoffeeFields | null>(null);
  const [image, setImage] = useState<ImageChoice>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data || fields) return;
    const { coffee: c } = data;
    setFields({
      name: c.name,
      roaster: c.roaster,
      country: c.country,
      region: c.region,
      farm: c.farm,
      producer: c.producer,
      varieties: c.varieties,
      process: c.process,
      process_detail: c.process_detail,
      altitude: c.altitude,
      harvest: c.harvest,
      roast_level: c.roast_level,
      roast_for: c.roast_for,
      roaster_notes: c.roaster_notes,
      description: c.description,
      weight_g: c.weight_g,
      price_eur: c.price_eur,
      cup_score: c.cup_score,
      roaster_recipes: c.roaster_recipes,
      url: c.url,
    });
    setImage(c.image ? { kind: "file", file: c.image } : null);
  }, [data, fields]);

  const back = `/kaffee/${id}`;

  if (error)
    return (
      <>
        <Toolbar>
          <BackLink to="/">Bibliothek</BackLink>
        </Toolbar>
        <Page>
          <EmptyState icon={Coffee} title="Kaffee nicht gefunden" text={error.message} />
        </Page>
      </>
    );

  if (isLoading || !data || !fields)
    return (
      <>
        <Toolbar />
        <div className="flex justify-center py-24">
          <Spinner size={24} />
        </div>
      </>
    );

  const c = data.coffee;

  const save = async () => {
    const clean = cleanFields(fields);
    if (!clean.name) return toast("Bitte einen Namen eingeben", "error");
    setSaving(true);
    try {
      const file = await resolveImage(image);
      const color = file === c.image ? c.color : await colorFor(file);
      await api.updateCoffee(id, { ...clean, image: file, color, wishlist: c.wishlist, archived: c.archived, source: c.source });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["coffee", id] }),
        qc.invalidateQueries({ queryKey: ["coffees"] }),
        qc.invalidateQueries({ queryKey: ["stats"] }),
      ]);
      toast("Gesichert");
      navigate(back, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Toolbar tab={`${c.name} bearbeiten`}>
        <BackLink to={back}>{c.name}</BackLink>
        <div className="flex-1" />
        <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          Sichern
        </Button>
      </Toolbar>
      <Page narrow>
        <LargeTitle>Bearbeiten</LargeTitle>
        <form
          className="flex flex-col gap-7"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <CoffeeFieldsForm value={fields} onChange={setFields} />
          <ImagePicker value={image} onChange={setImage} color={c.color} roast={fields.roast_level} saved={c.image} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => navigate(back)}>
              Abbrechen
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Sichern
            </Button>
          </div>
        </form>
      </Page>
    </>
  );
}
