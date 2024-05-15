import React from 'react';

interface ProjectCardProps {
  title: string;
  description: string;
  mediaUrl: string;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ title, description, mediaUrl }) => {
  return (
    <div className="bg-white shadow-lg rounded-lg overflow-hidden mb-6">
      <div className="h-80 overflow-hidden">
        <video className="w-full h-full object-cover" src={mediaUrl} autoPlay loop muted />
      </div>
      <div className="p-4">
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-gray-700">{description}</p>
      </div>
    </div>
  );
};

export default ProjectCard;
