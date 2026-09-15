import { useMemo, useState } from "react";
import type { IndianDishOption, MealAnalysisItem, MealItemInput } from "../types";

type MealDraftRow = {
  key: string;
  itemId?: string;
  dishId: string;
  portionGrams: number;
  portionBasis: "estimated" | "measured";
};

function newRow(dish?: IndianDishOption): MealDraftRow {
  return {
    key: `meal-row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dishId: dish?.id ?? "",
    portionGrams: dish?.defaultPortion.grams ?? 150,
    portionBasis: "estimated",
  };
}

function initialRows(
  items: MealAnalysisItem[] | undefined,
  dishes: IndianDishOption[],
  suggestedItems: MealItemInput[] | undefined,
): MealDraftRow[] {
  if (items?.length) {
    return items.map((item) => ({
      key: item.itemId || `meal-row-${item.dishId}`,
      itemId: item.itemId,
      dishId: item.dishId,
      portionGrams: item.portion.selectedGrams,
      portionBasis:
        item.portion.basis === "user_measured_weight" ? "measured" : "estimated",
    }));
  }
  if (suggestedItems?.length) {
    return suggestedItems.map((item, index) => {
      const dish = dishes.find((option) => option.id === item.dishId);
      return {
        key: item.itemId || `meal-suggestion-${item.dishId}-${index}`,
        itemId: item.itemId,
        dishId: item.dishId,
        portionGrams: item.portionGrams ?? dish?.defaultPortion.grams ?? 150,
        portionBasis: item.portionBasis ?? "estimated",
      };
    });
  }
  return [newRow()];
}

export default function MealConfirmationPanel({
  dishes,
  items,
  suggestedItems,
  title = "Confirm what is on the plate",
  submitLabel = "Calculate meal nutrition",
  loading = false,
  error = "",
  onCancel,
  onSubmit,
}: {
  dishes: IndianDishOption[];
  items?: MealAnalysisItem[];
  suggestedItems?: MealItemInput[];
  title?: string;
  submitLabel?: string;
  loading?: boolean;
  error?: string;
  onCancel?: () => void;
  onSubmit: (items: MealItemInput[]) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<MealDraftRow[]>(() =>
    initialRows(items, dishes, suggestedItems),
  );
  const [search, setSearch] = useState("");

  const visibleDishes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return dishes;
    return dishes.filter((dish) =>
      `${dish.name} ${dish.category} ${dish.aliases.join(" ")}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [dishes, search]);

  const canSubmit =
    rows.length > 0 &&
    rows.every(
      (row) => row.dishId && Number.isFinite(row.portionGrams) && row.portionGrams > 0,
    );

  const updateDish = (key: string, dishId: string) => {
    const dish = dishes.find((option) => option.id === dishId);
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              dishId,
              portionGrams: dish?.defaultPortion.grams ?? row.portionGrams,
            }
          : row,
      ),
    );
  };

  const submit = () => {
    if (!canSubmit || loading) return;
    void onSubmit(
      rows.map(({ itemId, dishId, portionGrams, portionBasis }) => ({
        ...(itemId ? { itemId } : {}),
        dishId,
        portionGrams,
        portionBasis,
      })),
    );
  };

  return (
    <section
      aria-labelledby="meal-confirmation-title"
      className="rounded-[20px] border border-white/15 bg-[#101923]/95 p-4 text-white shadow-2xl backdrop-blur-md"
    >
      <div className="mb-3">
        <h2 id="meal-confirmation-title" className="m-0 text-base font-extrabold">
          {title}
        </h2>
        <p className="mt-1 text-[11px] leading-4 text-white/65">
          Select every visible dish and confirm its approximate weight. This prevents the app from
          inventing food names or exact portions from an uncertain image.
        </p>
        {suggestedItems?.length ? (
          <p className="mt-2 rounded-xl bg-[#F5A623]/15 px-3 py-2 text-[10px] leading-4 text-[#FFD48A]">
            Image suggestions are prefilled. Check every dish and portion before calculating.
          </p>
        ) : null}
      </div>

      <label className="mb-3 block text-[11px] font-semibold text-white/75">
        Search the supported Indian dish catalogue
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="For example: dal, roti, paneer"
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-xs text-white outline-none placeholder:text-white/35 focus:border-[#F5A623]"
        />
      </label>

      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {rows.map((row, index) => (
          <div key={row.key} className="rounded-2xl border border-white/10 bg-white/[0.07] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#F5A623]">Item {index + 1}</span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                  className="rounded-lg px-2 py-1 text-[10px] font-semibold text-white/55 hover:bg-white/10 hover:text-white"
                  aria-label={`Remove meal item ${index + 1}`}
                >
                  Remove
                </button>
              ) : null}
            </div>

            <label className="block text-[10px] font-semibold text-white/60">
              Dish
              <select
                value={row.dishId}
                onChange={(event) => updateDish(row.key, event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-[#18232f] px-3 py-2.5 text-xs text-white outline-none focus:border-[#F5A623]"
              >
                <option value="">Select a dish</option>
                {visibleDishes.map((dish) => (
                  <option key={dish.id} value={dish.id}>
                    {dish.name} · {dish.category}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-2 grid grid-cols-[1fr_1.2fr] gap-2">
              <label className="text-[10px] font-semibold text-white/60">
                Portion (grams)
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="2000"
                  step="5"
                  value={row.portionGrams}
                  onChange={(event) => {
                    const portionGrams = Number(event.target.value);
                    setRows((current) =>
                      current.map((item) =>
                        item.key === row.key ? { ...item, portionGrams } : item,
                      ),
                    );
                  }}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-xs text-white outline-none focus:border-[#F5A623]"
                />
              </label>
              <label className="text-[10px] font-semibold text-white/60">
                Weight source
                <select
                  value={row.portionBasis}
                  onChange={(event) => {
                    const portionBasis = event.target.value as MealDraftRow["portionBasis"];
                    setRows((current) =>
                      current.map((item) =>
                        item.key === row.key ? { ...item, portionBasis } : item,
                      ),
                    );
                  }}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-[#18232f] px-3 py-2.5 text-xs text-white outline-none focus:border-[#F5A623]"
                >
                  <option value="estimated">My estimate</option>
                  <option value="measured">Measured weight</option>
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((current) => [...current, newRow()])}
        className="mt-3 w-full rounded-xl border border-dashed border-white/20 py-2 text-xs font-bold text-white/70 hover:border-white/40 hover:text-white"
      >
        + Add another dish
      </button>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-[#E4483C]/15 px-3 py-2 text-[11px] text-[#FF8B82]">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-xl bg-white/10 py-2.5 text-xs font-bold text-white disabled:opacity-50"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || loading}
          className="flex-[2] rounded-xl bg-[#1B7A43] py-2.5 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Calculating…" : submitLabel}
        </button>
      </div>
    </section>
  );
}
