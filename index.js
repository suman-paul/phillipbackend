const express = require('express')
const app = express()
var cors = require('cors')
require('dotenv').config()

app.use(cors())

const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

const api = new WooCommerceRestApi({
  url: "https://www.cartaloq.com",
  consumerKey: process.env.WOO_CONSUMER_KEY,
  consumerSecret: process.env.WOO_CONSUMER_SECRET,
  version: "wc/v3"
});

async function searchProducts(searchString) {
    return api.get("products", {
        search: searchString,
    })
}

async function getProductById(pId) {
  return api.get(`products/${pId}`)
}

app.get('/', (req, res) => {
  res.send('Hello')
})

app.get('/products/:productId', async (req, res) => {
  // let ra = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  // console.log(ra)
    product = await getProductById(req.params.productId)
    res.json(product.data)
})

app.get('/products', async (req, res) => {
  if(!req.query.search) {
    res.json([])
  }
    products = await searchProducts(req.query.search)
    res.json(products.data)
})

const port = process.env.PORT || 8000

app.listen(port, () => {
  console.log(`listening on port ${port}`)
})