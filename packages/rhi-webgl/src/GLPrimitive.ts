import { GLCapabilityType, Logger, Primitive } from "@oasis-engine/core";
import { SubPrimitive } from "@oasis-engine/core/types/graphic/SubPrimitive";
import { IPlatformPrimitive } from "@oasis-engine/design";
import { WebGLExtension } from "./type";
import { WebGLRenderer } from "./WebGLRenderer";

/**
 * Improvement of VAO:
 * 1) WebGL2.0 must support VAO, almost all devices support vao extensions in webgl1.0, we can use PollyFill,only keep VAO mode.
 * 2) VAO implementation now has bugs, change IndexBuffer、VertexBuffer、VertexElements need to update VAO.
 */

/**
 * GL platform primtive.
 */
export class GLPrimitive implements IPlatformPrimitive {
  protected readonly _primitive: Primitive;
  protected attribLocArray: number[];
  protected readonly canUseInstancedArrays: boolean;

  private gl: (WebGLRenderingContext & WebGLExtension) | WebGL2RenderingContext;
  private vao: Map<number, WebGLVertexArrayObject> = new Map();
  private readonly _useVao: boolean;

  constructor(rhi: WebGLRenderer, primitive: Primitive) {
    this._primitive = primitive;
    this.canUseInstancedArrays = rhi.canIUse(GLCapabilityType.instancedArrays);
    this._useVao = rhi.canIUse(GLCapabilityType.vertexArrayObject);
    this.gl = rhi.gl;
  }

  /**
   * Draw the primitive.
   */
  draw(shaderProgram: any, subPrimitive: SubPrimitive) {
    const gl = this.gl;
    const primitive = this._primitive;

    if (this._useVao) {
      if (!this.vao.has(shaderProgram.id)) {
        this.registerVAO(shaderProgram);
      }
      const vao = this.vao.get(shaderProgram.id);
      gl.bindVertexArray(vao);
    } else {
      this.bindBufferAndAttrib(shaderProgram);
    }

    const { indexBufferBinding, instanceCount, _glIndexType } = primitive;
    const { topology, start, count } = subPrimitive;

    if (!instanceCount) {
      if (indexBufferBinding) {
        if (this._useVao) {
          gl.drawElements(topology, count, _glIndexType, start);
        } else {
          const { _nativeBuffer } = indexBufferBinding.buffer;
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, _nativeBuffer);
          gl.drawElements(topology, count, _glIndexType, start);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        }
      } else {
        gl.drawArrays(topology, start, count);
      }
    } else {
      if (this.canUseInstancedArrays) {
        if (indexBufferBinding) {
          if (this._useVao) {
            gl.drawElementsInstanced(topology, count, _glIndexType, start, instanceCount);
          } else {
            const { _nativeBuffer } = indexBufferBinding.buffer;
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, _nativeBuffer);
            gl.drawElementsInstanced(topology, count, _glIndexType, start, instanceCount);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
          }
        } else {
          gl.drawArraysInstanced(topology, start, count, instanceCount);
        }
      } else {
        Logger.error("ANGLE_instanced_arrays extension is not supported");
      }
    }

    // unbind
    if (this._useVao) {
      gl.bindVertexArray(null);
    } else {
      this.disableAttrib();
    }
  }

  destroy() {
    if (this._useVao) {
      const gl = this.gl;
      this.vao.forEach((vao) => {
        gl.deleteVertexArray(vao);
      });
    }
  }

  /**
   * Bind buffer and attribute.
   */
  protected bindBufferAndAttrib(shaderProgram: any) {
    const gl = this.gl;
    const primitive = this._primitive;
    const vertexBufferBindings = primitive.vertexBufferBindings;

    this.attribLocArray = [];
    const attributeLocation = shaderProgram.attributeLocation;
    const attributes = primitive._vertexElementMap;

    let vbo: WebGLBuffer;
    let lastBoundVbo: WebGLBuffer;

    for (const name in attributeLocation) {
      const loc = attributeLocation[name];
      if (loc === -1) continue;

      const element = attributes[name];
      if (element) {
        const { buffer, stride } = vertexBufferBindings[element.bindingIndex];
        vbo = buffer._nativeBuffer;
        // prevent binding the vbo which already bound at the last loop, e.g. a buffer with multiple attributes.
        if (lastBoundVbo !== vbo) {
          lastBoundVbo = vbo;
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        }

        gl.enableVertexAttribArray(loc);
        const { size, type } = element._glElementInfo;
        gl.vertexAttribPointer(loc, size, type, element.normalized, stride, element.offset);
        if (this.canUseInstancedArrays) {
          gl.vertexAttribDivisor(loc, element.instanceDivisor);
        }
        this.attribLocArray.push(loc);
      } else {
        Logger.warn("vertex attribute not found: " + name);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  protected disableAttrib() {
    const gl = this.gl;
    for (let i = 0, l = this.attribLocArray.length; i < l; i++) {
      gl.disableVertexAttribArray(this.attribLocArray[i]);
    }
  }

  private registerVAO(shaderProgram: any): void {
    const gl = this.gl;
    const vao = gl.createVertexArray();

    /** register VAO */
    gl.bindVertexArray(vao);

    const { indexBufferBinding } = this._primitive;
    if (indexBufferBinding) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBufferBinding.buffer._nativeBuffer);
    }
    this.bindBufferAndAttrib(shaderProgram);

    /** unbind */
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    this.disableAttrib();

    this.vao.set(shaderProgram.id, vao);
  }
}
