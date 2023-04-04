const express = require('express')
const axios = require('axios');
const AesEncryption = require('aes-encryption')
const app = express()
var cors = require('cors')
require('dotenv').config()

app.use(cors())
app.use(express.json())

const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

const loyalityUrl = process.env.LOYALITY_URL;

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

async function getProductVariationsById(pId) {
  return api.get(`products/${pId}/variations`)
}

async function getProductVariationByVariationId(pId, vId) {
  return api.get(`products/${pId}/variations/${vId}`)
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

app.get('/products/:productId/variations', async (req, res) => {
  // let ra = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  // console.log(ra)
    product = await getProductVariationsById(req.params.productId)
    res.json(product.data)
})

app.get('/products/:productId/variations/:variationId', async (req, res) => {
  // let ra = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  // console.log(ra)
    product = await getProductVariationByVariationId(req.params.productId, req.params.variationId)
    res.json(product.data)
})

app.get('/products', async (req, res) => {
  if(!req.query.search) {
    res.json([])
  }
    products = await searchProducts(req.query.search)
    res.json(products.data)
})

app.get('/getTestCifNumber', async (req, res) => {
  res.json('CM955834')
})

app.post('/memberName', async(req, res) => {
  cifnumber = req.body.cifnumber
  axios.post(`${loyalityUrl}/GetMemberName`, {
    "cifnumber": cifnumber
  }, {
    auth: {
      username: process.env.LOYALITY_USERNAME,
      password: process.env.LOYALITY_PASSWORD
    }
  }
  
  ).then(response => {
    res.json(response.data.GetMemberNameResult.membername)
  })
  .catch(error => {
    console.log(error);
    res.json(null)
  });
})

app.post('/memberTotalPoints', async(req, res) => {
  cifnumber = req.body.cifnumber
  axios.post(`${loyalityUrl}/GetMemberPoint`, {
    "cifnumber": cifnumber
  }, {
    auth: {
      username: process.env.LOYALITY_USERNAME,
      password: process.env.LOYALITY_PASSWORD
    }
  }
  
  ).then(response => {
    res.json(response.data.GetMemberPointResult.memberpoint)
  })
  .catch(error => {
    console.log(error);
    res.json(null)
  });
})

app.post('/sendEncryptedCif', async(req, res) => {
  const encrypted_cifnumber_hex = req.body.encrypted_cifnumber_hex
  if(encrypted_cifnumber_hex) {
    console.log(encrypted_cifnumber_hex)
    const aes = new AesEncryption()
    aes.setSecretKey('11122233344455566677788822244455555555555555555231231321313aaaff')
    try {
      const decrypted = aes.decrypt(encrypted_cifnumber_hex)
      console.log('decrypted >>>>>>', decrypted)
      res.statusCode = 200
      res.send("CifNumber recorded Sucessfully")
    } catch (error) {
      res.statusCode = 500
      res.send(error.reason)
    }
  } else {
    res.statusCode = 400
    res.send("Enter encrypted_cifnumber_hex in body")
  }
  
  
})

const port = process.env.PORT || 8000

app.listen(port, () => {
  console.log(`listening on port ${port}`)
})