// Editable DOM content anchored to the existing input mat in world space.
// The draft enters the suspended execution only when the user submits it.
export function inputFieldPose(layout,camera,width,height,id='tool:input') {
  const mat=layout.toolRectangle(id);
  const content={x:mat.x+16,y:mat.y+52,width:mat.width-32,height:mat.height-68};
  const origin=camera.toScreen(content);
  return {...origin,width:content.width,height:content.height,scale:camera.scale,
    visible:camera.visible(content,width,height)};
}

export function positionInputField(element,renderer,id='tool:input') {
  const pose=inputFieldPose(renderer.layout,renderer.camera,renderer.width,renderer.height,id);
  element.hidden=!pose.visible;
  element.style.width=`${pose.width}px`;
  element.style.height=`${pose.height}px`;
  element.style.transform=`translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`;
  element.style.setProperty?.('--io-font',`${Math.min(32,Math.max(18,13/pose.scale))}px`);
  element.style.setProperty?.('--io-hint-font',`${Math.min(24,Math.max(13,10/pose.scale))}px`);
  return pose;
}
