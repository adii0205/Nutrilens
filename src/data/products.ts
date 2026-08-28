export type NutrientRating = "good" | "moderate" | "bad";

export interface Nutrient {
  name: string;
  value: string;
  per100g: number;
  rating: NutrientRating;
  detail: string;
}

export interface Product {
  name: string;
  brand: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  gradeColor: string;
  gradeBg: string;
  kcal: number;
  servingSize: string;
  allergens: string[];
  nutrients: Nutrient[];
  aiSummary: string;
  image: string;
  ingredients: string;
}

export const PRODUCTS: Record<string, Product> = {
  "Oatly Oat Milk": {
    name: "Oatly Oat Milk",
    brand: "Oatly",
    score: 88,
    grade: "A",
    gradeColor: "#1B7A43",
    gradeBg: "#E9F7EF",
    kcal: 46,
    servingSize: "200ml",
    allergens: ["Gluten (oats)"],
    nutrients: [
      { name: "Calories", value: "46 kcal", per100g: 46, rating: "good", detail: "Low calorie" },
      { name: "Saturated Fat", value: "0.2g", per100g: 0.2, rating: "good", detail: "Very low — heart healthy" },
      { name: "Sugars", value: "4.0g", per100g: 4.0, rating: "moderate", detail: "Naturally occurring" },
      { name: "Sodium", value: "60mg", per100g: 60, rating: "good", detail: "Low sodium" },
      { name: "Fibre", value: "0.8g", per100g: 0.8, rating: "good", detail: "Good fibre source" },
      { name: "Protein", value: "1.0g", per100g: 1.0, rating: "moderate", detail: "Moderate protein" },
    ],
    aiSummary: "Oatly Oat Milk is an excellent plant-based dairy alternative. Low in saturated fat and calories, it's suitable for most dietary needs. The natural oat sugars are not a concern at this serving size. A great everyday choice.",
    image: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=300&h=300&fit=crop&auto=format",
    ingredients: "Oat base (water, oats 10%), low erucic acid rapeseed oil, calcium carbonate, calcium phosphates, iodine, riboflavin (B2), vitamin D2, vitamin B12.",
  },
  "Grenade Protein Bar": {
    name: "Grenade Protein Bar",
    brand: "Grenade",
    score: 62,
    grade: "B",
    gradeColor: "#F5A623",
    gradeBg: "#FFF4E0",
    kcal: 212,
    servingSize: "60g bar",
    allergens: ["Milk", "Soya", "Peanuts", "Tree nuts", "Gluten"],
    nutrients: [
      { name: "Calories", value: "212 kcal", per100g: 353, rating: "moderate", detail: "Moderate energy" },
      { name: "Saturated Fat", value: "3.2g", per100g: 5.3, rating: "moderate", detail: "Moderate — watch intake" },
      { name: "Sugars", value: "1.8g", per100g: 3.0, rating: "good", detail: "Low sugar" },
      { name: "Sodium", value: "240mg", per100g: 400, rating: "moderate", detail: "Moderate sodium" },
      { name: "Fibre", value: "4.8g", per100g: 8.0, rating: "good", detail: "High fibre" },
      { name: "Protein", value: "20.6g", per100g: 34.3, rating: "good", detail: "Excellent protein" },
    ],
    aiSummary: "Grenade bars are high in protein and fibre, making them a useful post-workout snack. However, the multiple allergen warnings — including peanuts and tree nuts — make this unsuitable for your allergen profile. Proceed with caution.",
    image: "https://images.unsplash.com/photo-1622484211901-dcd7f9e1def3?w=300&h=300&fit=crop&auto=format",
    ingredients: "Protein blend (milk protein, soya protein), humectant (glycerol), peanut butter (9%), chocolate flavour coating (sugar, cocoa butter, skimmed milk powder), water, palm fat, fibre, flavourings.",
  },
  "Pringles Original": {
    name: "Pringles Original",
    brand: "Kellogg's",
    score: 24,
    grade: "D",
    gradeColor: "#E4483C",
    gradeBg: "#FDEAE9",
    kcal: 149,
    servingSize: "30g (approx 14 crisps)",
    allergens: ["Wheat", "Milk"],
    nutrients: [
      { name: "Calories", value: "149 kcal", per100g: 497, rating: "bad", detail: "Very high energy density" },
      { name: "Saturated Fat", value: "2.7g", per100g: 9.0, rating: "bad", detail: "High — raises LDL cholesterol" },
      { name: "Sugars", value: "0.8g", per100g: 2.6, rating: "good", detail: "Low sugar" },
      { name: "Sodium", value: "204mg", per100g: 680, rating: "bad", detail: "Very high sodium" },
      { name: "Fibre", value: "1.0g", per100g: 3.4, rating: "moderate", detail: "Some fibre" },
      { name: "Protein", value: "1.4g", per100g: 4.7, rating: "bad", detail: "Low protein" },
    ],
    aiSummary: "Pringles score poorly on almost every health metric. Very high in energy density, saturated fat, and sodium. A 30g serving provides over a third of your daily recommended sodium. Enjoy only occasionally and in small portions.",
    image: "https://images.unsplash.com/photo-1571748982800-fa51082c2224?w=300&h=300&fit=crop&auto=format",
    ingredients: "Dried potatoes, vegetable oil (sunflower, corn, high oleic soybean oil), degerminated yellow corn flour, cornstarch, rice flour, maltodextrin, mono and diglycerides, salt.",
  },
  "Alpro Soya Yogurt": {
    name: "Alpro Soya Yogurt",
    brand: "Alpro",
    score: 79,
    grade: "B",
    gradeColor: "#F5A623",
    gradeBg: "#FFF4E0",
    kcal: 55,
    servingSize: "125g pot",
    allergens: ["Soya"],
    nutrients: [
      { name: "Calories", value: "55 kcal", per100g: 44, rating: "good", detail: "Low calorie" },
      { name: "Saturated Fat", value: "0.5g", per100g: 0.4, rating: "good", detail: "Very low" },
      { name: "Sugars", value: "6.3g", per100g: 5.0, rating: "moderate", detail: "Added fruit sugars" },
      { name: "Sodium", value: "63mg", per100g: 50, rating: "good", detail: "Low sodium" },
      { name: "Fibre", value: "0.5g", per100g: 0.4, rating: "moderate", detail: "Low fibre" },
      { name: "Protein", value: "4.5g", per100g: 3.6, rating: "good", detail: "Good plant protein" },
    ],
    aiSummary: "Alpro Soya Yogurt is a solid plant-based yogurt alternative. Low in calories and saturated fat with decent protein. Sugar content is slightly elevated from added fruit — choose the plain/unsweetened variant for a better score.",
    image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=300&h=300&fit=crop&auto=format",
    ingredients: "Water, soya (9.6%), sugar, modified maize starch, live cultures (S. thermophilus, L. bulgaricus), acidity regulators (citric acid, sodium citrate), flavouring.",
  },
  "Quaker Oats": {
    name: "Quaker Oats",
    brand: "Quaker",
    score: 91,
    grade: "A",
    gradeColor: "#1B7A43",
    gradeBg: "#E9F7EF",
    kcal: 172,
    servingSize: "45g dry (+ milk)",
    allergens: ["Gluten (oats)", "May contain nuts"],
    nutrients: [
      { name: "Calories", value: "172 kcal", per100g: 382, rating: "moderate", detail: "Good sustained energy" },
      { name: "Saturated Fat", value: "0.9g", per100g: 1.9, rating: "good", detail: "Very low" },
      { name: "Sugars", value: "0.4g", per100g: 1.0, rating: "good", detail: "Naturally low" },
      { name: "Sodium", value: "5mg", per100g: 11, rating: "good", detail: "Negligible sodium" },
      { name: "Fibre", value: "3.6g", per100g: 8.0, rating: "good", detail: "Excellent beta-glucan fibre" },
      { name: "Protein", value: "5.6g", per100g: 12.5, rating: "good", detail: "Good protein" },
    ],
    aiSummary: "Quaker Oats are an outstanding breakfast choice. Rich in beta-glucan soluble fibre, which is clinically proven to lower LDL cholesterol. Negligible sugar and sodium. High sustained energy release makes this ideal for keeping you full until lunch.",
    image: "https://images.unsplash.com/photo-1504649629636-04e1a8c3e44a?w=300&h=300&fit=crop&auto=format",
    ingredients: "Wholegrain rolled oats (100%). May contain traces of milk, nuts, and sesame.",
  },
};
