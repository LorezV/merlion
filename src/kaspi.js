const fs = require("fs")
const path = require("path")
const papa = require("papaparse")
const { getUserAgent, downloadImage, createLogger } = require("./utils")
const puppeteer = require("puppeteer")
const { PrismaClient, DocumentTypeEnum } = require("@prisma/client");

const logger = createLogger()
const prisma = new PrismaClient()

async function parse() {
  const file = fs.createReadStream(path.join(__dirname, "../", "vendor", "kaspi.csv"))
  let count = 0

  let supplierDB = await prisma.supplier.findFirst({where: {name: "Kaspi"}})
  if (!supplierDB) supplierDB = await prisma.supplier.create({data: { name: "Kaspi" }})

  let currencyDB = await prisma.currency.findFirst({ where: { name: "kzt" } });
  if (!currencyDB) currencyDB = await prisma.currency.create({ data: { name: "kzt", CurrencyRate: { create: { rate: 1, date: new Date() } } } });

  let languageDB = await prisma.language.findFirst({ where: { language: "eu" } })
  if (!languageDB) languageDB = await prisma.language.create({ data: { language: "eu" } })

  let uCategoryDB = await prisma.category.findFirst({ where: { name: "unknown" } })
  if (!uCategoryDB) uCategoryDB = await prisma.category.create({ data: { name: "unknown" } })

  let c1 = 0
  let c2 = 0
  await new Promise((resolve) => {
    papa.parse(file, {
      worker: true,
      skipEmptyLines: true,
      delimiter: ",",
      step: async ({ data }, parser) => {
        const result = {
          brand: data[0],
          categoryString: data[1],
          partnumber: data[5],
          name: data[6],
          price: parseFloat(data[10]),
          model: data[32],
          model2: data[37],
        }
        parser.pause()

        await (async () => {
          if (result.model.length < 1 && result.model2.length < 1) return
          const model = result.model.length > 0 ? result.model : result.model2

          const regexp = new RegExp(`${result.brand}`, "is")
          if (!result.name.match(regexp)) return

          result.name = result.name.replace(regexp, "").replace("  ", " ")

          let categoryDB = uCategoryDB
          for (const cName of result.categoryString.split(",")) {
            const catCandidate = await prisma.category.findFirst({where: { name: cName }})
            if (catCandidate) {
              categoryDB = catCandidate
              break
            }
          }
          
          let vendorDB = await prisma.vendor.findFirst({ where: { name: result.brand } })
          if (!vendorDB) vendorDB = await prisma.vendor.create({ data: { name: result.brand } })

          let productDB = await prisma.product.findFirst({where: {
            vendor_partnumber: model
          }})

          if (!productDB) {
            productDB = await prisma.product.create({
              data: {
                vendor_id: vendorDB.id,
                vendor_partnumber: model,
                name: result.name,
                category_id: categoryDB.id
              }
            })
          }

          
          let supplierProductPriceDB = await prisma.supplierProductPrice.findFirst({
            where: {
              product_id: productDB.id,
              supplier_id: supplierDB.id
            }
          })

          if (supplierProductPriceDB) {
            supplierProductPriceDB = await prisma.supplierProductPrice.create({
              data: {
                product_id: productDB.id,
                supplier_id: supplierDB.id,
                price_date: new Date(),
                price: result.price,
                supplier_partnumber: result.partnumber,
                currency_id: currencyDB.id
              }
            })
          }

          console.log(`Parsed product id:${productDB.id}`)

        })()

        parser.resume()
      },
      complete: () => {
        resolve(true)
      }
    })
  })
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