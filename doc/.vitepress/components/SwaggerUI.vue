<script setup>
import { onMounted } from 'vue'
import SwaggerUI from 'swagger-ui-dist/swagger-ui-bundle'
import 'swagger-ui-dist/swagger-ui.css'
import { withBase } from 'vitepress'

onMounted(() => {
  SwaggerUI({
    url: withBase('/openapi.yaml'),
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [
      SwaggerUI.presets.apis,
      SwaggerUI.SwaggerUIStandalonePreset
    ],
  })
})
</script>

<div id="swagger-ui"></div>

<style>
/* Reset some VitePress styles that mess with Swagger UI */
#swagger-ui .wrapper {
  max-width: none;
  padding: 0;
}
</style>
