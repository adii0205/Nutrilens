import io
import numpy as np
from PIL import Image

# Food categories with estimated base nutritional profiles (per 100g serving)
FOOD_CATEGORIES = {
    "Salad / Fresh Greens": {
        "category": "Healthy Vegetables",
        "calories": 45,
        "saturatedFat": 0.5,
        "sugars": 2.1,
        "sodium": 85,
        "fiber": 3.8,
        "protein": 2.5,
        "allergens": [],
        "healthNote": "Rich in essential micronutrients, dietary fiber, and antioxidants."
    },
    "Grilled Chicken / Lean Protein Bowl": {
        "category": "Lean Protein",
        "calories": 165,
        "saturatedFat": 1.2,
        "sugars": 0.5,
        "sodium": 240,
        "fiber": 1.2,
        "protein": 28.0,
        "allergens": [],
        "healthNote": "High protein content supports muscle recovery and metabolic health."
    },
    "Fruit Bowl / Berry Mix": {
        "category": "Fresh Fruit",
        "calories": 62,
        "saturatedFat": 0.1,
        "sugars": 11.4,
        "sodium": 5,
        "fiber": 4.2,
        "protein": 1.1,
        "allergens": [],
        "healthNote": "Packed with natural vitamins, phytochemicals, and hydration."
    },
    "Rice & Vegetable Grain Bowl": {
        "category": "Complex Carbs",
        "calories": 140,
        "saturatedFat": 0.6,
        "sugars": 1.2,
        "sodium": 180,
        "fiber": 2.5,
        "protein": 4.2,
        "allergens": [],
        "healthNote": "Good energy source from complex carbohydrates."
    },
    "Pasta & Tomato Sauce": {
        "category": "Carbohydrates",
        "calories": 180,
        "saturatedFat": 1.5,
        "sugars": 4.5,
        "sodium": 320,
        "fiber": 2.1,
        "protein": 5.5,
        "allergens": ["Gluten"],
        "healthNote": "Moderate energy density; pair with vegetables for balanced glycemic response."
    },
    "Pizza Slice": {
        "category": "Fast Food",
        "calories": 266,
        "saturatedFat": 4.8,
        "sugars": 3.6,
        "sodium": 560,
        "fiber": 1.8,
        "protein": 11.0,
        "allergens": ["Gluten", "Dairy"],
        "healthNote": "High in saturated fats and sodium. Enjoy in moderation."
    },
    "Cheeseburger & Fries": {
        "category": "Fast Food",
        "calories": 310,
        "saturatedFat": 6.5,
        "sugars": 5.2,
        "sodium": 680,
        "fiber": 1.5,
        "protein": 14.5,
        "allergens": ["Gluten", "Dairy", "Soy"],
        "healthNote": "High in refined fats, sodium, and energy density."
    },
    "Pastry / Cake / Dessert": {
        "category": "Sweets",
        "calories": 380,
        "saturatedFat": 8.2,
        "sugars": 28.5,
        "sodium": 290,
        "fiber": 0.8,
        "protein": 4.0,
        "allergens": ["Gluten", "Dairy", "Eggs"],
        "healthNote": "High sugar and refined fat content; limit daily intake."
    },
    "Vegetable Curry / Stew": {
        "category": "Stew / Curry",
        "calories": 115,
        "saturatedFat": 2.2,
        "sugars": 3.8,
        "sodium": 380,
        "fiber": 3.5,
        "protein": 3.8,
        "allergens": [],
        "healthNote": "Nutrient-dense with spices such as turmeric and ginger providing anti-inflammatory benefits."
    },
    "Smoothie / Healthy Juice": {
        "category": "Beverage",
        "calories": 78,
        "saturatedFat": 0.2,
        "sugars": 14.2,
        "sodium": 25,
        "fiber": 2.0,
        "protein": 1.5,
        "allergens": [],
        "healthNote": "Hydrating fruit drink; watch total natural sugar concentration."
    }
}

class FoodImageBaseline:
    """Temporary RGB heuristic used until the trained Week 2 model is ready.

    This class intentionally does not expose a confidence probability. Its
    relative scores are useful for deterministic prototype behaviour only and
    must not be interpreted as model accuracy or calibrated confidence.
    """

    model_loaded = False

    def predict_image(self, image_bytes: bytes):
        """Return a heuristic category and its class-level nutrient estimate."""
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Color & texture feature extraction for deterministic vision representation
        img_resized = img.resize((64, 64))
        arr = np.array(img_resized, dtype=np.float32)
        r_avg, g_avg, b_avg = arr[:, :, 0].mean(), arr[:, :, 1].mean(), arr[:, :, 2].mean()

        category_keys = list(FOOD_CATEGORIES.keys())
        
        # Calculate visual similarity heuristics based on the RGB spectrum.
        # Green dominance -> Salad / Green Vegetables
        # Red/Orange dominance -> Curry / Fruit / Tomato Pasta
        # Yellow/Brown dominance -> Burger / Pastry / Grain Bowl
        scores = []
        for cat in category_keys:
            if "Salad" in cat and g_avg > r_avg and g_avg > b_avg:
                score = 0.88 + (g_avg / 255.0) * 0.1
            elif "Fruit" in cat and r_avg > 140:
                score = 0.85 + (r_avg / 255.0) * 0.1
            elif "Curry" in cat and r_avg > g_avg and g_avg > b_avg:
                score = 0.82 + (r_avg / 255.0) * 0.12
            elif "Cheeseburger" in cat and r_avg > 100 and g_avg > 80:
                score = 0.80 + (r_avg / 255.0) * 0.1
            elif "Chicken" in cat:
                score = 0.78 + (r_avg / 255.0) * 0.1
            else:
                score = 0.50 + ((r_avg + g_avg + b_avg) / 765.0) * 0.25
            scores.append(score)

        top_indices = np.argsort(scores)[::-1][:3]
        max_score = max(scores)
        top_predictions = []
        for idx in top_indices:
            cat_name = category_keys[idx]
            top_predictions.append({
                "label": cat_name,
                "relativeScore": round(float(scores[idx] / max_score) * 100, 1),
                "category": FOOD_CATEGORIES[cat_name]["category"]
            })

        best_cat_name = top_predictions[0]["label"]
        best_profile = FOOD_CATEGORIES[best_cat_name]

        return {
            "predictedFoodName": best_cat_name,
            "category": best_profile["category"],
            "confidence": None,
            "modelArchitecture": "Mean-RGB heuristic baseline",
            "inferenceSource": "heuristic_baseline",
            "topPredictions": top_predictions,
            "estimatedNutrients": {
                "calories": best_profile["calories"],
                "saturatedFat": best_profile["saturatedFat"],
                "sugars": best_profile["sugars"],
                "sodium": best_profile["sodium"],
                "fiber": best_profile["fiber"],
                "protein": best_profile["protein"],
            },
            "allergens": best_profile["allergens"],
            "healthNote": best_profile["healthNote"]
        }
