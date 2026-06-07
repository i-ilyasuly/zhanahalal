import { db } from "./src_server_db.js";

async function runPhase2() {
  console.log("🚀 2-Кезең: Жаңа өрістерді (Schema) бекіту басталды...");
  const snap = await db.collection("search_companies").get();
  console.log(`📦 Деректер базасында ${snap.docs.length} мекеме табылды.`);

  let batch = db.batch();
  let count = 0;
  const batchSize = 250;

  for (const doc of snap.docs) {
    const data = doc.data();

    // Map existing lat/lon to coordinates
    const lat = data.lat || null;
    const lng = data.lon || null;
    const coordinates = { lat, lng };

    // Format featured_image
    let featured_image = { thumbnail: "", full: "" };
    if (typeof data.featured_image === 'string') {
      featured_image.full = data.featured_image;
      featured_image.thumbnail = data.featured_image;
    }

    // Determine type
    let type = "food_service";
    if (data.category_type && (data.category_type.includes("slaughterhouse") || data.category_type.includes("producer"))) {
       type = "producer";
    } else if (data.category_type && data.category_type.includes("shop")) {
       type = "retail";
    }

    // Build the new document structure
    const updatedData = {
      // Basic Info
      source_id: data.id || null, // Keep original ID reference
      title: data.title || "",
      legal_name: data.legal_name || "",
      slug: data.slug || "",
      title_aliases: data.search_fields?.synonyms || [], 
      type: type,
      category: data.category_type || "",
      subcategories: [],
      short_description: data.desc || "",
      description_clean: data.desc || "",
      tags: data.search_fields?.tags || [],
      embedding: data.search_fields?.embedding || [],
      is_active: true,

      // Certificate Info
      certificate_status: data.certificate_status || "active",
      certificate: {
        number: data.certificate?.number || "",
        issued_at: data.certificate?.issued_at || null,
        expires_at: data.certificate?.expires_at || null,
        issuer: "ҚМДБ", 
        document_url: ""
      },
      halal_certificate_type: "full",

      // Contact & Location
      city: "",
      address: data.address || "",
      map_link: data.map_link || "",
      coordinates: coordinates,
      phone: data.phone || "",
      website: data.website || "",
      is_delivery_only: false,

      // Working Hours
      working_hours: {
        monday: { open: null, close: null },
        tuesday: { open: null, close: null },
        wednesday: { open: null, close: null },
        thursday: { open: null, close: null },
        friday: { open: null, close: null },
        saturday: { open: null, close: null },
        sunday: { open: null, close: null },
      },
      is_24_7: false,

      // Media
      featured_image: featured_image,
      logo_image: data.logo_image || "",
      photos: data.photos || [],
      additional_images: [],

      // Food Service Specific
      cuisine_type: [],
      specialties: [],
      menu_items: [],
      menu_photos: [],
      dine_options: [],
      has_prayer_room: false,
      has_halal_alcohol: false,
      capacity: 0,
      target_audience: [],
      average_check: 0,

      // Producer Specific
      product_categories: [],
      product_catalog: data.products || [],
      brand_names: [],

      // Retail Specific
      meat_types: [],

      // Meta data
      price_range: "medium",
      last_verified_date: null,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
      data_version: 2
    };

    const newRef = db.collection("search_companies").doc(doc.id);
    batch.set(newRef, updatedData); 

    count++;
    if (count % batchSize === 0) {
      await batch.commit();
      batch = db.batch();
      console.log(`✅ ${count} мекеме жаңартылды...`);
    }
  }

  if (count % batchSize !== 0) {
    await batch.commit();
  }
  
  console.log(`🎉 Барлық ${count} мекемеге жаңа өрістер сәтті қосылды! 2-Кезең аяқталды.`);
}

runPhase2().catch(console.error).finally(() => process.exit(0));
