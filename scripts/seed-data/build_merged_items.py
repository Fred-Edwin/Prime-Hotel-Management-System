"""
One-off script: merges docs/client-data/hotel-menu-items.json (restaurant
catalog) and canteen-items.json (canteen catalog) into a single flat item
list matching the `items` table schema, applying Prime Hotel's real
category/supply_type/pricing rules established during Phase 8 seeding
(see docs/phases/phase8_context.md).

Rules applied (confirmed with the client/user during Phase 8):
- Category names mapped 1:1 to the item_category enum (see
  supabase/migrations/20260713120000_add_item_categories.sql for the new
  values this required: stationery, dawa, sweets, biscuits,
  packing_supplies, others).
- An item name appearing in BOTH files is the same physical item flowing
  restaurant -> canteen: one row, supply_type = canteen_supplied, using
  the restaurant file's price as the source of truth.
- An item only in hotel-menu-items.json: restaurant_only.
- An item only in canteen-items.json: canteen_independent.
- Items with two prices (selling_price + selling_price_alt) are split
  into two separate rows, the second suffixed "(price)" -- the two
  prices likely represent different quantities/sizes of the same item.
- Missing/zero buying_price is estimated via a category-based margin
  heuristic (buying ~= selling * margin), flagged as a placeholder.
- A handful of items had no usable price anywhere (both selling and
  buying blank/zero) or an implausible real buying_price (e.g. a 1-2%
  margin, likely a data-entry error) -- both get a manually-set
  placeholder selling/buying price, confirmed with the user, flagged for
  the client to correct later via the Items screen if wrong.

Run: python3 scripts/seed-data/build_merged_items.py
Output: scripts/seed-data/merged_items.json (consumed by
scripts/seed-data/seed_real_items.mjs)
"""
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CATEGORY_MAP = {
    "Beverages": "beverages",
    "Snacks": "snacks",
    "Meals": "meals",
    "Fruits": "fruits",
    "Cyber": "cyber",
    "Retail": "retail",
    "Stationeries": "stationery",
    "Dawa": "dawa",
    "Sweets": "sweets",
    "Biscuits": "biscuits",
    "Packing Supplies": "packing_supplies",
    "Others": "others",
}

CATEGORY_MARGIN = {
    "beverages": 0.55,
    "snacks": 0.55,
    "meals": 0.55,
    "fruits": 0.55,
    "cyber": 0.35,
    "retail": 0.65,
    "stationery": 0.65,
    "dawa": 0.65,
    "sweets": 0.65,
    "biscuits": 0.80,
    "packing_supplies": 0.65,
    "others": 0.65,
}

MANUAL_SELLING_PRICE = {
    ("Soda 500ml TA", "restaurant"): 55.0,
    ("Tumblers all", "restaurant"): 100.0,
    ("PawPaw", "canteen"): 30.0,
    ("Bottles", "canteen"): 10.0,
    ("Serviettes", "canteen"): 10.0,
}

# Real buying_price values from the source data that look like data-entry
# errors (implausibly low margin) -- overridden with the category
# estimate instead, confirmed with the user.
SUSPICIOUS_REAL_PRICE_OVERRIDE = {"Chicken Stew", "Chips Full", "SHA & Others"}


def load(path):
    with open(path) as f:
        return json.load(f)


def estimate_buying_price(selling_price, category):
    if selling_price is None or selling_price <= 0:
        return None
    return round(selling_price * CATEGORY_MARGIN.get(category, 0.6), 2)


def make_rows(raw_list, source_label, flow_lookup):
    rows = []
    for item in raw_list:
        name = item["name"]
        category = CATEGORY_MAP[item["category"]]
        supply_type = flow_lookup(name)

        prices = [
            p for p in (item.get("selling_price"), item.get("selling_price_alt"))
            if p is not None and p > 0
        ]
        if not prices:
            manual = MANUAL_SELLING_PRICE.get((name, source_label))
            prices = [manual] if manual else [0]

        for idx, sp in enumerate(prices):
            row_name = name if idx == 0 else f"{name} ({int(sp)})"
            bp = item.get("buying_price")
            placeholder_price = False

            if bp is None or bp <= 0:
                bp = estimate_buying_price(sp, category)
                placeholder_price = True
            if (name, source_label) in MANUAL_SELLING_PRICE:
                placeholder_price = True
            if name in SUSPICIOUS_REAL_PRICE_OVERRIDE:
                bp = estimate_buying_price(sp, category)
                placeholder_price = True

            rows.append({
                "name": row_name,
                "category": category,
                "supply_type": supply_type,
                "selling_price": sp,
                "buying_price": bp if bp is not None else 1,
                "source": source_label,
                "placeholder_price": placeholder_price,
            })
    return rows


def main():
    hotel = load(os.path.join(BASE, "docs/client-data/hotel-menu-items.json"))
    canteen = load(os.path.join(BASE, "docs/client-data/canteen-items.json"))

    hotel_by_name = {i["name"]: i for i in hotel}
    canteen_by_name = {i["name"]: i for i in canteen}

    restaurant_rows = make_rows(
        hotel, "restaurant",
        lambda name: "canteen_supplied" if name in canteen_by_name else "restaurant_only",
    )
    canteen_only = [i for i in canteen if i["name"] not in hotel_by_name]
    canteen_rows = make_rows(canteen_only, "canteen", lambda name: "canteen_independent")

    all_rows = restaurant_rows + canteen_rows

    for r in all_rows:
        assert r["selling_price"] > 0, f"Zero selling price survived: {r}"

    print(f"Total rows: {len(all_rows)}")
    print(f"Placeholder-priced rows: {sum(1 for r in all_rows if r['placeholder_price'])}")

    out_path = os.path.join(BASE, "scripts/seed-data/merged_items.json")
    with open(out_path, "w") as f:
        json.dump(all_rows, f, indent=2)
    print(f"Written to {out_path}")


if __name__ == "__main__":
    main()
