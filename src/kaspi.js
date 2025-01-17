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
  let countModel1 = 0
  let countModel2 = 0

  let supplierDB = await prisma.supplier.findFirst({where: {name: "Kaspi"}})
  if (!supplierDB) supplierDB = await prisma.supplier.create({data: { name: "Kaspi" }})

  let currencyDB = await prisma.currency.findFirst({ where: { name: "usd" } });

  let languageDB = await prisma.language.findFirst({ where: { language: "eu" } })
  if (!languageDB) languageDB = await prisma.language.create({ data: { language: "eu" } })

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
          price: Math.ceil(parseFloat(data[10]) * 0.002226 * 100) / 100,
          model: data[32].trim(),
          model2: data[37].trim(),
        }
        parser.pause()

        await (async () => {
          const brandRegexp = new RegExp(`(\\s|^)${result.brand}(\\s|&)`, "img")

          if (!brandRegexp.test(result.name)) return
          result.name = result.name.replace(brandRegexp, "").replace("  ", " ")

          if (result.model.length < 1 && result.model2.length < 1) return

          let vendor_partnumber; let model; let isModel2 = false;
          if (result.model.length > 0) {
            let temp = result.model.replace(brandRegexp, "").trim().replace("(", "").replace(")", "")
            while (temp.includes("\"")) {
              temp = temp.replace("\"", "")
            }
            const match = temp.match(/(^| )[A-Za-z0-9\-А-Яа-я\/-]+$/mig)
            if (match) {
              vendor_partnumber = match[0].trim()
              model = temp
            }
          } else {
            vendor_partnumber = result.model2
            model = result.model2
            isModel2 = true
          }

          if (!vendor_partnumber) return

          let productDB = await prisma.product.findFirst({where: {
            vendor_partnumber: vendor_partnumber
          }})

          if (productDB) {
            let supplierProductPriceDB = await prisma.supplierProductPrice.findFirst({
              where: {
                product_id: productDB.id,
                supplier_id: supplierDB.id
              }
            })
            
            if (!supplierProductPriceDB) {
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

              console.log(`Parsed product id:${productDB.id}`)
              if (isModel2) countModel2++
              else countModel1++
            }
          }

        })()

        parser.resume()
      },
      complete: () => {
        console.log(`Finded by model: ${countModel1}\nFinded by model2: ${countModel2}\nGeneral count: ${countModel1 + countModel2}`)
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