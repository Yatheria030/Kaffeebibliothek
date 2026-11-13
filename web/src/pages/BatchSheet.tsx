import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { BATCH_CHOICES, choiceOf, fromChoice, type Batch, type BatchChoice, type CoffeeDetail } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { todayIso } from "../lib/format.ts";
import { Button, Segmented } from "../ui/controls.tsx";
import { Group, NumField, Row, TextArea } from "../ui/form.tsx";
import { confirmDialog, Sheet, toast } from "../ui/overlay.tsx";

const dateCls = "field h-9 w-auto text-right text-[15px]";

export function BatchSheet({
  open,
  onClose,
  detail,
  batch,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  detail: CoffeeDetail;
  batch: Batch | null;
  onSaved?: (id: number | null) => void;
}) {
  if (!open) return null;
  return <BatchSheetBody onClose={onClose} detail={detail} batch={batch} onSaved={onSaved} />;
}

function BatchSheetBody({
  onClose,
  detail,
  batch,
  onSaved,
}: {
  onClose: () => void;
  detail: CoffeeDetail;
  batch: Batch | null;
  onSaved?: (id: number | null) => void;
}) {
  const qc = useQueryClient();
  const c = detail.coffee;
  const anyOpen = detail.batches.some((b) => b.status === "offen" && b.id !== batch?.id);
  const [roastDate, setRoastDate] = useState(batch?.roast_date ?? "");
  const [openedAt, setOpenedAt] = useState(batch?.opened_at ?? "");
  const [weight, setWeight] = useState<number | null>(batch ? batch.weight_g : c.weight_g);
  const [price, setPrice] = useState<number | null>(batch ? batch.price_eur : c.price_eur);
  const [choice, setChoice] = useState<BatchChoice>(batch ? choiceOf(batch) : anyOpen ? "ungeoeffnet" : "offen");
  const [note, setNote] = useState(batch?.note ?? "");
  const [saving, setSaving] = useState(false);

  const refresh = () =>
    Promise.all([["coffee", c.id], ["coffees"], ["stats"]].map((k) => qc.invalidateQueries({ queryKey: k })));

  const save = async () => {
    setSaving(true);
    try {
      const input = {
        roast_date: roastDate || null,
        // „Geöffnet am“ nur bei offenen Chargen mit heute vorbelegen, nachgetragene und aufgebrauchte bleiben wie eingetragen
        opened_at: openedAt || (choice === "offen" ? todayIso() : null),
        weight_g: weight,
        price_eur: price,
        ...fromChoice(choice),
        note: note.trim(),
      };
      const { id } = batch ? await api.updateBatch(batch.id, input) : await api.createBatch(c.id, input);
      await refresh();
      toast(batch ? "Charge gesichert" : c.wishlist ? "Charge eingetragen, Kaffee ist jetzt in der Bibliothek" : "Charge eingetragen");
      onSaved?.(id);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Speichern fehlgeschlagen", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!batch) return;
    const ok = await confirmDialog({
      title: "Charge löschen?",
      message:
        batch.brew_count > 0
          ? `Die ${batch.brew_count} Bezüge bleiben erhalten, verlieren aber die Zuordnung zur Charge.`
          : "Die Charge wird endgültig entfernt.",
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteBatch(batch.id);
      await refresh();
      toast("Charge gelöscht");
      onSaved?.(null);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Löschen fehlgeschlagen", "error");
    }
  };

  return (
    <Sheet open onClose={onClose} title={batch ? "Charge bearbeiten" : "Neue Charge"} onSave={() => void save()} saving={saving} width={560}>
      <div className="flex flex-col gap-7">
        <Group
          footer={
            choice === "nachgetragen"
              ? "Nachgetragen: Daten nur eintragen, wenn du sie noch weißt. Leer bleibt leer."
              : "Das Röstdatum zählt die Tage für den Verlauf. Gewicht und Preis kommen vorbelegt von der Packung."
          }
        >
          <Row label="Röstdatum" htmlFor="bt-roast">
            <input id="bt-roast" type="date" max={todayIso()} value={roastDate} onChange={(e) => setRoastDate(e.target.value)} className={dateCls} />
          </Row>
          <Row label="Geöffnet am" htmlFor="bt-open">
            <input id="bt-open" type="date" max={todayIso()} value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className={dateCls} />
          </Row>
          <Row label="Gewicht" htmlFor="bt-weight">
            <NumField id="bt-weight" value={weight} onChange={setWeight} suffix="g" integer />
          </Row>
          <Row label="Preis" htmlFor="bt-price">
            <NumField id="bt-price" value={price} onChange={setPrice} suffix="€" />
          </Row>
        </Group>

        <Group title="Status">
          <div className="p-3">
            <Segmented label="Status" full wrap value={choice} onChange={setChoice} options={BATCH_CHOICES} />
          </div>
        </Group>

        <Group title="Notiz">
          <TextArea id="bt-note" label="Notiz" value={note} onChange={setNote} placeholder="z. B. Shop, Lagerung, Besonderheiten" rows={3} />
        </Group>

        {batch && (
          <div className="flex justify-center">
            <Button variant="danger" icon={Trash2} onClick={() => void remove()}>
              Charge löschen
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
