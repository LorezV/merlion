const fs = require("fs");
const path = require("path");
const papa = require("papaparse");
const { getUserAgent, downloadImage, createLogger } = require("./utils");
const puppeteer = require("puppeteer");
const { PrismaClient, DocumentTypeEnum } = require("@prisma/client");

const logger = createLogger();
const prisma = new PrismaClient();

async function parse() {
  const file = fs.createReadStream(
    path.join(__dirname, "../", "vendor", "al-style.csv")
  );
  let count = 0;
  let countProducts = 0;

  await prisma.$queryRaw`SELECT setval('"Product_id_seq"', (SELECT MAX(id) FROM "Product"));`
  await prisma.$queryRaw`SELECT setval('"Description_id_seq"', (SELECT MAX(id) FROM "Description"));`
  await prisma.$queryRaw`SELECT setval('"Supplier_id_seq"', (SELECT MAX(id) FROM "Supplier"));`

  let supplierDB = await prisma.supplier.findFirst({
    where: { name: "Al-Style" },
  });
  if (!supplierDB) {
    supplierDB = await prisma.supplier.create({ data: { name: "Al-Style" } });
  }
  let currencyDB = await prisma.currency.findFirst({ where: { name: "usd" } });
  if (!currencyDB) {
    currencyDB = await prisma.currency.create({ data: { name: "usd" } });
  }
  let languageID = await prisma.language.findFirst({where: { language: "ru" }})
  if (!languageID)
    languageID = await prisma.language.create({ data: { language: "ru" } });

  if (!supplierDB || !currencyDB) {
    console.error("Seed database first!");
    logger("Seed database first!");
    process.exit(0);
  }

  const unknownVendorDB = await prisma.vendor.findFirst({where: {name: "Unknown"}})

  const r = await prisma.supplierProductPrice.deleteMany({
    where: { supplier_id: supplierDB.id },
  });

  console.log(`Deleted ${r.count} entities.`);

  await new Promise((resolve) => {
    papa.parse(file, {
      worker: true,
      skipEmptyLines: true,
      step: async ({ data }, parser) => {
        parser.pause();

        await (async () => {
          const result = {
            supplier_partnumber: data[0],
            vendor_partnumber: data[1],
            title: data[2],
            fullTitle: data[3],
            price: data[4],
            category: "",
            vendor: "",
            desc: ""
          };

          if (
            !result.supplier_partnumber.length > 0 ||
            !result.vendor_partnumber.length > 0 ||
            !result.price.length > 0 ||
            !data[0].match(/^[0-9]+$/gm)
          ) return;

          result.price = Math.ceil(parseFloat(result.price) * 0.002206 * 100) / 100;
          result.category = result.fullTitle.split(",")[0].trim()
          result.vendor = (result.fullTitle.split(",")[1]?.trim())
          result.desc = result.fullTitle.split(", ").slice(2).join(", ").trim()

          if (result.vendor) {
            result.vendor = result.vendor.toUpperCase()
          } else return

          let productDB = await prisma.product.findFirst({
            where: { vendor_partnumber: result.vendor_partnumber },
          });
          if (!productDB) {
            const descriptionDB = await prisma.description.create({data: {
              text: result.desc,
              language_id: languageID.id
            }})

            let categoryDB = await prisma.category.findFirst({
              where: { name: result.category },
            });

            if (!categoryDB)
              categoryDB = await prisma.category.findFirst({
                where: { name: "Unknown" },
              });

            let vendorDB = await prisma.vendor.findFirst({
              where: { name: result.vendor },
            });
            if (!vendorDB) vendorDB = unknownVendorDB
            
            productDB = await prisma.product.create({
              data: {
                vendor_id: vendorDB.id,
                vendor_partnumber: result.vendor_partnumber,
                name: result.title,
                category_id: categoryDB.id,
                description_id: descriptionDB.id
              },
            });

            countProducts++
          }

          if (productDB) {
            const supplierProductPrice = await prisma.supplierProductPrice.create({
              data: {
                product_id: productDB.id,
                supplier_id: supplierDB.id,
                price_date: new Date(),
                price: result.price,
                supplier_partnumber: result.supplier_partnumber,
                currency_id: currencyDB.id
              }
            })
          }

          count++
        })();

        parser.resume();
      },
      complete: () => {
        console.log(count);
        console.log(countProducts);
        resolve(true);
      },
    });
  });
}

async function main() {
  await parse()
  console.log("end")
  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
})